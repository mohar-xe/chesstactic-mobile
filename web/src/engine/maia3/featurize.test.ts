import { describe, expect, it } from 'vitest';
import { buildTokenTensor, mirrorSquare, parseFen, tokenizeBoard } from './featurize';

describe('featurize', () => {
  it('parses FEN fields', () => {
    const parsed = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(parsed.turn).toBe('w');
    expect(parsed.castling).toBe('KQkq');
  });

  it('mirrors squares vertically', () => {
    expect(mirrorSquare(0)).toBe(56); // a1 -> a8
    expect(mirrorSquare(63)).toBe(7); // h8 -> h1
  });

  it('tokenizes the starting position into 64x12 features', () => {
    const tokens = tokenizeBoard('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(tokens).toBeInstanceOf(Float32Array);
    expect(tokens.length).toBe(64 * 12);
    // Side to move (white) pawns on rank 2: a2 index 8 has pawn slot 0 set.
    expect(tokens[8 * 12 + 0]).toBe(1);
  });

  it('pads history by repeating the earliest position', () => {
    const a = new Float32Array(64 * 12).fill(1);
    const b = new Float32Array(64 * 12).fill(2);
    const tensor = buildTokenTensor([a, b], 4);
    expect(tensor.length).toBe(64 * 12 * 4);
    expect(tensor[0]).toBe(1); // padded first slot
    expect(tensor[64 * 12 * 2]).toBe(1);
    expect(tensor[64 * 12 * 3]).toBe(2);
  });
});
