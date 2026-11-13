import { Chess } from 'chess.js';

/** The position a loaded game started from, or undefined for the normal start. */
export function startFenOf(chess: Chess, pgn?: string): string | undefined {
  const h = chess.getHeaders();
  if (h.SetUp === '1' && h.FEN) return h.FEN;
  if (pgn && /^\[SetUp\s+"1"\]/m.test(pgn)) return /^\[FEN\s+"([^"]+)"\]/m.exec(pgn)?.[1];
  return undefined;
}
