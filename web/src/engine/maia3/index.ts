// The on-device opponent: Maia-3 (Chessformer) running as a UCI-free engine.
//
// A prediction is produced from the current position plus the position history
// (the model reads the last `history` positions, exactly like upstream's
// `--use-uci-history` mode).

import { buildTokenTensor, tokenizeBoard } from './featurize';
import { moveLogitIndex } from './vocab';
import { sampleFromLogits } from './sampler';
import type { OnnxRunner } from './runtime';

export interface MaiaSettings {
  /** Elo the model believes the side to move has. */
  selfElo: number;
  /** Elo the model believes the opponent has. */
  oppoElo: number;
  /** 0 = always the most likely human move, 1 = sample from the distribution. */
  temperature: number;
  topP: number;
  /** How many past positions the model reads. */
  history: number;
}

export const DEFAULT_MAIA_SETTINGS: MaiaSettings = {
  selfElo: 1400,
  oppoElo: 1400,
  temperature: 1,
  topP: 1,
  history: 8,
};

export interface LegalMove {
  uci: string;
  san: string;
}

export interface MaiaCandidate extends LegalMove {
  probability: number;
  logit: number;
}

export interface MaiaPrediction {
  uci: string;
  san: string;
  probability: number;
  candidates: MaiaCandidate[];
  /** Win/draw/loss from the side-to-move's perspective, 0..1 each. */
  wdl: { win: number; draw: number; loss: number };
  /** Model's expected think time in seconds, when the head gives a sane value. */
  ponderSeconds: number | null;
}

export class MaiaEngine {
  private settings: MaiaSettings;

  constructor(private readonly runner: OnnxRunner, settings: Partial<MaiaSettings> = {}) {
    this.settings = { ...DEFAULT_MAIA_SETTINGS, ...settings };
  }

  get currentSettings(): MaiaSettings {
    return { ...this.settings };
  }

  /** Release the underlying ONNX session. */
  async dispose(): Promise<void> {
    await this.runner.dispose();
  }

  update(patch: Partial<MaiaSettings>): void {
    this.settings = { ...this.settings, ...patch };
  }

  /**
   * @param fen            the current position
   * @param previousFens   positions before it, oldest first
   * @param legal          legal moves in the current position
   */
  async predict(fen: string, previousFens: string[], legal: LegalMove[]): Promise<MaiaPrediction> {
    if (legal.length === 0) throw new Error('No legal moves');

    const blackToMove = fen.split(' ')[1] === 'b';
    const history = [...previousFens, fen].map((f) => tokenizeBoard(f));
    const tokens = buildTokenTensor(history, this.settings.history);

    const raw = await this.runner.run(tokens, this.settings.selfElo, this.settings.oppoElo);

    const logits = legal.map((move) => raw.logitsMove[moveLogitIndex(move.uci, blackToMove)] ?? -Infinity);
    const chosen = sampleFromLogits(logits, {
      temperature: this.settings.temperature,
      topP: this.settings.topP,
    });
    const index = chosen >= 0 ? chosen : 0;

    // Probabilities over the legal moves (temperature 1) for display.
    const max = Math.max(...logits);
    const exps = logits.map((l) => (Number.isFinite(l) ? Math.exp(l - max) : 0));
    const sum = exps.reduce((a, b) => a + b, 0);
    const probabilities = exps.map((e) => (sum > 0 ? e / sum : 0));

    const candidates: MaiaCandidate[] = legal
      .map((move, i) => ({ ...move, probability: probabilities[i], logit: logits[i] }))
      .sort((a, b) => b.probability - a.probability);

    const wdl = valueToWdl(raw.logitsValue);

    return {
      uci: legal[index].uci,
      san: legal[index].san,
      probability: probabilities[index],
      candidates,
      wdl,
      ponderSeconds: ponderToSeconds(raw.logitsPonder),
    };
  }
}

/** Value logits are [loss, draw, win] for the side to move. */
export function valueToWdl(logits: Float32Array): { win: number; draw: number; loss: number } {
  const max = Math.max(logits[0] ?? 0, logits[1] ?? 0, logits[2] ?? 0);
  const exps = [0, 1, 2].map((i) => Math.exp((logits[i] ?? 0) - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return {
    loss: (sum > 0 ? exps[0] / sum : 0),
    draw: (sum > 0 ? exps[1] / sum : 0),
    win: (sum > 0 ? exps[2] / sum : 0),
  };
}

/**
 * The ponder head is a raw regression output. Upstream never converts it, so
 * we only trust it when it lands in a plausible range for seconds.
 */
export function ponderToSeconds(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const seconds = Math.exp(value);
  if (!Number.isFinite(seconds) || seconds < 0.15 || seconds > 120) return null;
  return seconds;
}
