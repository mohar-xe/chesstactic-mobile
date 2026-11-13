// Port of maia3/maia3/dataset.py (AGPL-3.0, CSSLab) — the token pipeline that
// turns a chess position into the tensor Maia-3 expects.
//
// Two rules drive everything:
//
//  * A position is always seen from the side-to-move's point of view. When it
//    is Black's turn the board is mirrored (ranks flipped, colours swapped),
//    so the "own pieces" are always the first six token slots.
//  * The model reads the last `history` positions. When the game is shorter
//    than that, the earliest position is repeated to pad the window — exactly
//    what upstream does at inference time.

/** Piece types in the order Maia-3 encodes them (pawn..king). */
export const PIECE_ORDER = ['p', 'n', 'b', 'r', 'q', 'k'] as const;

export interface ParsedFen {
  placement: string;
  turn: 'w' | 'b';
  castling: string;
  ep: string;
  halfmove: number;
  fullmove: number;
}

export function parseFen(fen: string): ParsedFen {
  const parts = fen.trim().split(/\s+/);
  return {
    placement: parts[0] ?? '',
    turn: parts[1] === 'b' ? 'b' : 'w',
    castling: parts[2] ?? '-',
    ep: parts[3] ?? '-',
    halfmove: Number(parts[4] ?? 0),
    fullmove: Number(parts[5] ?? 1),
  };
}

/** Mirror a square index (0 = a1 .. 63 = h8) vertically. */
export function mirrorSquare(index: number): number {
  const rank = Math.floor(index / 8);
  const file = index % 8;
  return (7 - rank) * 8 + file;
}

/**
 * One-hot board tokens: 64 squares x 12 slots.
 * Slots 0-5 are the side-to-move's pawn..king, slots 6-11 the opponent's.
 */
export function tokenizeBoard(fen: string): Float32Array {
  const { placement, turn } = parseFen(fen);
  const out = new Float32Array(64 * 12);
  const mirrored = turn === 'b';

  let rank = 8;
  let file = 0;
  for (const ch of placement) {
    if (ch === '/') {
      rank -= 1;
      file = 0;
      continue;
    }
    if (ch >= '1' && ch <= '8') {
      file += Number(ch);
      continue;
    }
    const type = PIECE_ORDER.indexOf(ch.toLowerCase() as (typeof PIECE_ORDER)[number]);
    if (type < 0) continue;
    const isWhite = ch === ch.toUpperCase();

    let square = (rank - 1) * 8 + file;
    let ownColour = isWhite;
    if (mirrored) {
      square = mirrorSquare(square);
      ownColour = !isWhite;
    }
    const base = ownColour ? 0 : 6;
    out[square * 12 + base + type] = 1;
    file += 1;
  }
  return out;
}

/**
 * Stack the last `history` tokenised positions into the model's input tensor.
 * `history` is ordered oldest first; the newest position is last.
 */
export function buildTokenTensor(history: Float32Array[], historyLength = 8): Float32Array {
  if (history.length === 0) throw new Error('buildTokenTensor needs at least one position');
  const list = history.slice(-historyLength);
  while (list.length < historyLength) list.unshift(list[0]);

  const out = new Float32Array(64 * 12 * historyLength);
  for (let i = 0; i < list.length; i += 1) {
    out.set(list[i], 64 * 12 * i);
  }
  return out;
}

/** Number of input columns the exported graph expects (no clock features). */
export function tokenDimensions(historyLength = 8, includeTimeInfo = false): number {
  return 12 * historyLength + (includeTimeInfo ? 3 : 0);
}
