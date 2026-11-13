// Maia-3's move vocabulary — a direct port of maia3/maia3/utils.py
// `get_all_possible_moves()`.
//
// The network emits 4352 logits:
//   * 4096 = 64 source squares x 64 destination squares (row major)
//   * 256  = 8 source files x 8 destination files x 4 promotion pieces
//           (always rank 7 -> rank 8, because the board is mirrored for Black)
//
// The first 4096 are indexed in the *model's* square space (0 = a1 .. 63 = h8,
// mirrored when Black is to move), so we translate real squares into that
// space before looking a move up.

import { mirrorSquare } from './featurize';

export const MOVE_VOCAB_SIZE = 4352;
export const BASE_MOVES = 4096;
export const PROMOTION_BASE = 4096;

export const PROMOTION_PIECES = ['q', 'r', 'b', 'n'] as const;
export type PromotionPiece = (typeof PROMOTION_PIECES)[number];

/** Square index (0 = a1 .. 63 = h8) of an algebraic square. */
export function squareIndex(name: string): number {
  const file = name.charCodeAt(0) - 97;
  const rank = Number(name[1]) - 1;
  return rank * 8 + file;
}

export function squareName(index: number): string {
  const file = String.fromCharCode(97 + (index % 8));
  const rank = Math.floor(index / 8) + 1;
  return `${file}${rank}`;
}

/** Index of a plain (non-promotion) move in the vocabulary, in model space. */
export function baseMoveIndex(from: number, to: number, blackToMove: boolean): number {
  const f = blackToMove ? mirrorSquare(from) : from;
  const t = blackToMove ? mirrorSquare(to) : to;
  return f * 64 + t;
}

/** Index of a promotion in the vocabulary (files only, as upstream does). */
export function promotionMoveIndex(from: number, to: number, piece: string): number {
  const fromFile = from % 8;
  const toFile = to % 8;
  const pieceIdx = Math.max(0, PROMOTION_PIECES.indexOf(piece as PromotionPiece));
  return PROMOTION_BASE + (fromFile * 8 + toFile) * 4 + pieceIdx;
}

/**
 * The vocabulary entry for a UCI move, expressed in the model's square space.
 * Returns the raw index into the 4352-long logit vector.
 */
export function moveLogitIndex(uci: string, blackToMove: boolean): number {
  const from = squareIndex(uci.slice(0, 2));
  const to = squareIndex(uci.slice(2, 4));
  if (uci.length > 4) return promotionMoveIndex(from, to, uci[4]);
  return baseMoveIndex(from, to, blackToMove);
}
