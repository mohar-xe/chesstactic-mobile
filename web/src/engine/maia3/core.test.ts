import { describe, expect, it } from 'vitest';
import { sampleFromLogits, softmax } from './sampler';
import { baseMoveIndex, moveLogitIndex, promotionMoveIndex, squareIndex } from './vocab';

describe('softmax', () => {
  it('normalizes values to a probability distribution', () => {
    const probs = softmax([1, 1, 1]);
    expect(probs).toHaveLength(3);
    expect(probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(probs[0]).toBeCloseTo(1 / 3, 6);
  });
});

describe('sampleFromLogits', () => {
  it('returns argmax when temperature is 0', () => {
    expect(sampleFromLogits([0.1, 5.2, 1.3], { temperature: 0, topP: 1 })).toBe(1);
  });

  it('uses injected RNG for deterministic sampling', () => {
    const pick = sampleFromLogits([10, 0], { temperature: 1, topP: 1, random: () => 0.0 });
    expect(pick).toBe(0);
  });
});

describe('vocab mapping', () => {
  it('maps algebraic squares to indices', () => {
    expect(squareIndex('a1')).toBe(0);
    expect(squareIndex('h1')).toBe(7);
    expect(squareIndex('a8')).toBe(56);
    expect(squareIndex('h8')).toBe(63);
  });

  it('maps plain moves in white-to-move model space', () => {
    const from = squareIndex('e2');
    const to = squareIndex('e4');
    expect(baseMoveIndex(from, to, false)).toBe(from * 64 + to);
  });

  it('maps promotions to the promotion block', () => {
    const idx = promotionMoveIndex(squareIndex('e7'), squareIndex('e8'), 'q');
    expect(idx).toBeGreaterThanOrEqual(4096);
    expect(moveLogitIndex('e7e8q', false)).toBe(idx);
  });
});
