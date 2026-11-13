#!/usr/bin/env python3
"""Export a Maia-3 checkpoint to ONNX for the on-device engine.

The upstream project (https://github.com/CSSLab/maia3, AGPL-3.0) ships a
PyTorch inference server that speaks UCI. We do not want a Python runtime on a
phone, so we export the network itself and run it with ONNX Runtime.

Two upstream pieces need surgery before `torch.onnx.export` produces a clean
graph:

* `torch.nn.RMSNorm` has no ONNX op in opset 17, so it is replaced by an
  equivalent written in primitive ops.
* `torch.nn.MultiheadAttention` exports unreliably when it is called with a
  dynamic attention bias (Maia's Geometric Attention Bias), so it is replaced
  by an explicit q/k/v + softmax implementation that reads the same weights.

Everything else (Linear, LayerNorm, GELU, einsum -> matmul) exports as is.

Usage:
    python export_onnx.py --model maia3-5m --out ../models/maia3-5m.onnx
    python export_onnx.py --model maia3-5m --checkpoint maia3-5m.pt --out ...
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F

try:
    from maia3.model_registry import MODEL_SPECS
    from maia3.models import MAIA3Model
except ImportError:  # pragma: no cover - helpful message for CI users
    print(
        "maia3 is not importable. Install it with:\n"
        "  pip install 'git+https://github.com/CSSLab/maia3.git'",
        file=sys.stderr,
    )
    raise


# --------------------------------------------------------------------------
# export-friendly replacements
# --------------------------------------------------------------------------


class ManualRMSNorm(nn.Module):
    """RMSNorm written with primitive ops (ONNX has no RMSNorm before opset 23)."""

    def __init__(self, weight: torch.Tensor, eps: float):
        super().__init__()
        self.register_buffer("weight", weight.clone())
        self.eps = eps

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        var = x.pow(2).mean(dim=-1, keepdim=True)
        return x * torch.rsqrt(var + self.eps) * self.weight


class ManualMHA(nn.Module):
    """Explicit multi-head attention reading nn.MultiheadAttention's weights."""

    def __init__(self, mha: nn.MultiheadAttention, nheads: int):
        super().__init__()
        self.nheads = nheads
        self.head_dim = mha.embed_dim // nheads
        self.scale = 1.0 / math.sqrt(self.head_dim)
        self.in_proj_weight = mha.in_proj_weight
        self.out_proj = mha.out_proj
        self.in_proj_bias = mha.in_proj_bias

    def forward(self, query, key=None, value=None, need_weights=False, attn_mask=None, **kwargs):
        b, length, _ = query.shape
        bias = self.in_proj_bias
        qkv = F.linear(query, self.in_proj_weight, bias)
        q, k, v = qkv.chunk(3, dim=-1)

        def split(t: torch.Tensor) -> torch.Tensor:
            return t.view(b, length, self.nheads, self.head_dim).transpose(1, 2)

        q, k, v = split(q), split(k), split(v)
        scores = torch.matmul(q, k.transpose(-1, -2)) * self.scale
        if attn_mask is not None:
            if attn_mask.dim() == 3:
                scores = scores + attn_mask.view(b, self.nheads, length, length)
            else:
                scores = scores + attn_mask
        attn = torch.softmax(scores, dim=-1)
        out = torch.matmul(attn, v)
        out = out.transpose(1, 2).contiguous().view(b, length, -1)
        return self.out_proj(out), None


class ExportWrapper(nn.Module):
    """Feeds the model exactly the tensor it consumes.

    Upstream hands the network `12*history + 4` (or `12*history + 1`) columns
    and lets the model slice off the trailing label column. We do the slicing
    here so the exported graph takes a clean, documented input shape.
    """

    def __init__(self, model: nn.Module, slice_dim: int):
        super().__init__()
        self.model = model
        self.slice_dim = slice_dim

    def forward(self, tokens, self_elos, oppo_elos):
        return self.model(tokens[:, :, : self.slice_dim], self_elos, oppo_elos)


def patch_for_export(model: nn.Module, nheads: int) -> nn.Module:
    for name, module in list(model.named_modules()):
        for attr, child in list(module.named_children()):
            if isinstance(child, torch.nn.RMSNorm):
                eps = child.eps
                if eps is None:
                    eps = torch.finfo(child.weight.dtype).eps
                setattr(module, attr, ManualRMSNorm(child.weight.data, float(eps)))
            elif isinstance(child, nn.MultiheadAttention):
                setattr(module, attr, ManualMHA(child, nheads))
    return model


# --------------------------------------------------------------------------
# checkpoint loading
# --------------------------------------------------------------------------


def spec_for(name: str):
    for spec in MODEL_SPECS:
        if spec.name == name or name in spec.aliases:
            return spec
    raise SystemExit(f"unknown model '{name}'. known: {[s.name for s in MODEL_SPECS]}")


def build_config(spec) -> argparse.Namespace:
    cfg = dict(spec.config)
    cfg.setdefault("device", "cpu")
    cfg.setdefault("use_amp", False)
    cfg.setdefault("use_padding", True)
    cfg.setdefault("include_time_info", False)
    cfg.setdefault("history", 8)
    return argparse.Namespace(**cfg)


def load_checkpoint(spec, checkpoint: str | None) -> str:
    if checkpoint:
        return checkpoint
    from huggingface_hub import hf_hub_download  # imported lazily

    return hf_hub_download(
        repo_id=spec.repo_id,
        filename=spec.checkpoint_filename,
        cache_dir=None,
    )


def build_model(spec, checkpoint_path: str):
    cfg = build_config(spec)
    model = MAIA3Model(cfg)
    state = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    if isinstance(state, dict) and "model_state_dict" in state:
        state = state["model_state_dict"]
    renamed = {k.replace("smolgen", "gab"): v for k, v in state.items()}
    missing, unexpected = model.load_state_dict(renamed, strict=False)
    if missing:
        print(f"warning: missing keys: {missing[:5]}", file=sys.stderr)
    if unexpected:
        print(f"warning: unexpected keys: {unexpected[:5]}", file=sys.stderr)
    model.eval()
    return model, cfg


# --------------------------------------------------------------------------
# export
# --------------------------------------------------------------------------


def export(model, cfg, out_path: Path, opset: int) -> None:
    history = cfg.history
    include_time = getattr(cfg, "include_time_info", False)
    dims = 12 * history + (3 if include_time else 0)
    tokens = torch.zeros(1, 64, dims, dtype=torch.float32)
    elo = torch.tensor([1500], dtype=torch.long)

    wrapper = ExportWrapper(model, dims)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        wrapper,
        (tokens, elo, elo),
        str(out_path),
        input_names=["tokens", "self_elos", "oppo_elos"],
        output_names=["logits_move", "logits_value", "logits_ponder"],
        dynamic_axes=None,
        opset_version=opset,
        do_constant_folding=True,
        dynamo=False,
    )

    meta = {
        "model": spec_name(model),
        "history": history,
        "include_time_info": include_time,
        "token_dims": dims,
        "move_vocab": 4352,
        "opset": opset,
        "source": "https://github.com/CSSLab/maia3",
        "source_license": "AGPL-3.0",
    }
    out_path.with_suffix(".json").write_text(json.dumps(meta, indent=2))
    print(f"exported {out_path} ({out_path.stat().st_size / 1e6:.1f} MB)")


def spec_name(model) -> str:
    return getattr(model, "_export_name", "maia3")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model", default="maia3-5m", help="maia3-5m | maia3-23m | maia3-79m")
    ap.add_argument("--checkpoint", default=None, help="local .pt file (else downloaded from Hugging Face)")
    ap.add_argument("--out", required=True, help="output .onnx path")
    ap.add_argument("--opset", type=int, default=17)
    ap.add_argument("--quantize", action="store_true", help="also write an int8-quantised copy")
    args = ap.parse_args()

    spec = spec_for(args.model)
    cfg = build_config(spec)
    print(f"model: {spec.display_name}  config: {cfg}")

    checkpoint_path = load_checkpoint(spec, args.checkpoint)
    model, cfg = build_model(spec, checkpoint_path)
    model = patch_for_export(model, cfg.num_heads)
    model._export_name = spec.name  # type: ignore[attr-defined]

    out_path = Path(args.out)
    export(model, cfg, out_path, args.opset)

    if args.quantize:
        from onnxruntime.quantization import QuantType, quantize_dynamic

        int8 = out_path.with_name(out_path.stem + ".int8.onnx")
        quantize_dynamic(
            str(out_path),
            str(int8),
            weight_type=QuantType.QInt8,
            extra_options={"MatMulConstBOnly": True},
        )
        print(f"quantised {int8} ({int8.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
