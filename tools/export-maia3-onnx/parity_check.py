#!/usr/bin/env python3
"""Parity check: ONNX export vs. the original PyTorch model.

Generates random legal positions, builds Maia-3's token tensors exactly as the
upstream code does, then compares the PyTorch logits with the ONNX Runtime
logits. A passing check means the TypeScript featurizer + runtime can trust
the exported graph.

Usage:
    python parity_check.py --onnx models/maia3-5m.onnx --model maia3-5m \
        --checkpoint maia3-5m.pt --positions 200
"""

from __future__ import annotations

import argparse
import random
from collections import deque
from pathlib import Path

import numpy as np
import torch

from maia3.dataset import get_historical_tokens, tokenize_board
from maia3.model_registry import MODEL_SPECS
from maia3.models import MAIA3Model

from export_onnx import build_config, build_model, patch_for_export, spec_for


def random_position(rng: random.Random):
    """Play a random game and return (board, history of tokenised positions)."""
    import chess

    board = chess.Board()
    history = deque(maxlen=8)
    history.append(tokenize_board(board))
    for _ in range(rng.randint(0, 60)):
        moves = list(board.legal_moves)
        if not moves or board.is_game_over():
            break
        move = rng.choice(moves)
        board.push(move)
        history.append(tokenize_board(board))
    return board, history


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--onnx", required=True)
    ap.add_argument("--model", default="maia3-5m")
    ap.add_argument("--checkpoint", default=None)
    ap.add_argument("--positions", type=int, default=200)
    ap.add_argument("--tolerance", type=float, default=2e-3)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    import onnxruntime as ort

    spec = spec_for(args.model)
    cfg = build_config(spec)
    model, cfg = build_model(spec, args.checkpoint)
    model = patch_for_export(model, cfg.num_heads)
    model.eval()

    session = ort.InferenceSession(args.onnx, providers=["CPUExecutionProvider"])
    print("onnx inputs:", [i.name for i in session.get_inputs()])
    print("onnx outputs:", [o.name for o in session.get_outputs()])

    rng = random.Random(args.seed)
    worst = 0.0
    argmax_mismatch = 0
    top1_mismatch = 0
    checked = 0

    for i in range(args.positions):
        board, history = random_position(rng)
        if board.is_game_over():
            continue
        tokens = get_historical_tokens(history, cfg, base=0.0, inc=0.0, clk_left_before=0.0, clk_ponder=0.0)
        slice_dim = 12 * cfg.history + (3 if getattr(cfg, "include_time_info", False) else 0)
        x = tokens.unsqueeze(0)[:, :, :slice_dim]
        elo = torch.tensor([1500], dtype=torch.long)

        with torch.no_grad():
            pt_logits, _, _ = model(x, elo, elo)
        pt = pt_logits[0].numpy()

        out = session.run(None, {
            "tokens": x.numpy().astype(np.float32),
            "self_elos": np.array([1500], dtype=np.int64),
            "oppo_elos": np.array([1500], dtype=np.int64),
        })
        ox = out[0][0]

        diff = float(np.max(np.abs(pt - ox)))
        worst = max(worst, diff)
        if int(np.argmax(pt)) != int(np.argmax(ox)):
            argmax_mismatch += 1
        # the top-1 *legal* move is what actually matters
        legal = list(board.legal_moves)
        pt_legal = max(legal, key=lambda m: pt[move_index(m, board.turn)])
        ox_legal = max(legal, key=lambda m: ox[move_index(m, board.turn)])
        if pt_legal != ox_legal:
            top1_mismatch += 1
        checked += 1

    print(f"positions checked      : {checked}")
    print(f"max |logit difference| : {worst:.6f} (tolerance {args.tolerance})")
    print(f"argmax mismatches      : {argmax_mismatch}")
    print(f"top-1 legal mismatches : {top1_mismatch}")
    ok = worst <= args.tolerance and top1_mismatch == 0
    print("PARITY OK" if ok else "PARITY FAILED")
    raise SystemExit(0 if ok else 1)


def move_index(move, turn: str) -> int:
    """Index of a move in the model's 4352-long move vocabulary."""
    from maia3.utils import get_all_possible_moves, mirror_move

    global _VOCAB
    try:
        _VOCAB
    except NameError:
        _VOCAB = {m: i for i, m in enumerate(get_all_possible_moves())}
    uci = move.uci()
    if turn == "b":
        uci = mirror_move(uci)
    return _VOCAB[uci]


if __name__ == "__main__":
    main()
