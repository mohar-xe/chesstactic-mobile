// A "best move" for a single position.
//
// Used by the Learn section's play-tasks (play against the app until you mate
// or promote). On Android the bundled Stockfish answers; everywhere else the
// on-device Maia-3 model does — it plays like a person, which is good enough
// for a lesson opponent.

import { Chess } from 'chess.js';
import { createStockfishClient, type StockfishClient } from './stockfish/client';
import { loadMaiaEngine } from './maia3/useMaia';
import type { MaiaEngine } from './maia3';
import type { EngineTierId } from '../chess/types';

let stockfishPromise: Promise<StockfishClient> | null = null;
let maiaPromise: Promise<MaiaEngine | null> | null = null;
let maiaModel: EngineTierId | null = null;

async function stockfish(): Promise<StockfishClient> {
  stockfishPromise ??= createStockfishClient();
  return stockfishPromise;
}

async function maia(modelId: EngineTierId): Promise<MaiaEngine | null> {
  if (maiaModel !== modelId) {
    maiaModel = modelId;
    maiaPromise = loadMaiaEngine(modelId, { temperature: 0, topP: 1 })
      .catch(() => null);
  }
  return maiaPromise;
}

/**
 * The engine's preferred move in a position, or null when no engine is
 * available on this device.
 */
export async function engineBestMove(
  fen: string,
  options: { depth?: number; modelId?: EngineTierId } = {},
): Promise<string | null> {
  const depth = options.depth ?? 12;

  const client = await stockfish();
  if (client.available) {
    try {
      const lines = await client.analyze(fen, { depth, multiPv: 1 });
      const uci = lines[0]?.bestMove;
      if (uci) return uci;
    } catch {
      /* fall through to Maia */
    }
  }

  const engine = await maia(options.modelId ?? 'maia3-23m');
  if (!engine) return null;
  try {
    const legal = legalMovesOf(fen);
    if (!legal.length) return null;
    const prediction = await engine.predict(fen, [], legal);
    return prediction.uci;
  } catch {
    return null;
  }
}

function legalMovesOf(fen: string): { uci: string; san: string }[] {
  try {
    return new Chess(fen).moves({ verbose: true }).map((m) => ({
      uci: m.from + m.to + (m.promotion ?? ''),
      san: m.san,
    }));
  } catch {
    return [];
  }
}
