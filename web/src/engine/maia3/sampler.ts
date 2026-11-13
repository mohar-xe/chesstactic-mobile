// Move sampling that mirrors maia3/maia3/uci.py `sample_from_logits`.

export interface SampleOptions {
  /** 0 picks the most likely move, higher values play more loosely. */
  temperature: number;
  /** Nucleus sampling threshold; 1 disables it. */
  topP: number;
  /** Injectable RNG so tests are deterministic. */
  random?: () => number;
}

export interface WeightedMove {
  index: number;
  probability: number;
}

export function softmax(values: number[]): number[] {
  let max = -Infinity;
  for (const v of values) if (v > max) max = v;
  const exps = values.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => (sum > 0 ? e / sum : 0));
}

/**
 * Pick an index from `logits` (one entry per candidate move).
 * Returns the chosen index into `logits`.
 */
export function sampleFromLogits(logits: number[], options: SampleOptions): number {
  if (logits.length === 0) return -1;
  if (options.temperature <= 0) {
    let best = 0;
    for (let i = 1; i < logits.length; i += 1) if (logits[i] > logits[best]) best = i;
    return best;
  }

  const rnd = options.random ?? Math.random;
  const probs = softmax(logits.map((l) => l / options.temperature));

  let candidates: { index: number; probability: number }[] = probs.map((probability, index) => ({ index, probability }));

  if (options.topP < 1.0) {
    candidates = [...candidates].sort((a, b) => b.probability - a.probability);
    const kept: { index: number; probability: number }[] = [];
    let cumulative = 0;
    for (const candidate of candidates) {
      kept.push(candidate);
      cumulative += candidate.probability;
      if (cumulative > options.topP) break;
    }
    candidates = kept;
  }

  const total = candidates.reduce((a, c) => a + c.probability, 0);
  if (total <= 0) return candidates[0]?.index ?? -1;
  let pick = rnd() * total;
  for (const candidate of candidates) {
    pick -= candidate.probability;
    if (pick <= 0) return candidate.index;
  }
  return candidates[candidates.length - 1].index;
}
