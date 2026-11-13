// The player's memory: what keeps going wrong, what goes right, and where.
//
// Same idea as the server's coach memory, but computed from the analyses stored
// on the device. Mistakes are bucketed by *why* they were mistakes, using the
// deterministic move motifs (no LLM involved).

import { SCORING_VERSION } from '../chess/classifier';
import { fenToEpd } from '../chess/openings';
import { moveMotifs } from '../chess/tactics';
import type { AnalyzedMove, Color, GamePhase, PhaseSplit } from '../chess/types';
import { listAnalyses } from '../storage/db';
import { database } from '../storage/db';

export type MistakeKind = 'allowed_mate' | 'hung_piece' | 'missed_mate' | 'missed_win' | 'missed_tactic';

export interface PlayerMemory {
  gamesReviewed: number;
  /** Games (of gamesReviewed) with at least one mistake of each kind. */
  mistakeGames: Record<MistakeKind, number>;
  /** Accuracy per phase, averaged over the games that reached it. */
  phaseAccuracy: Partial<Record<GamePhase, number>>;
  /** Great or brilliant moves the player found. */
  greatFinds: number;
}

export const MEMORY_GAMES = 30;

/** Why a mistake was a mistake, from the position — null when nothing stands out. */
export function mistakeKind(
  m: Pick<AnalyzedMove, 'fen_before' | 'san' | 'best_move_san' | 'classification'>,
): MistakeKind | null {
  if (!['inaccuracy', 'mistake', 'blunder', 'miss'].includes(m.classification)) return null;
  const played = moveMotifs(m.fen_before, m.san);
  if (played?.allowsMate) return 'allowed_mate';
  if (played && played.hangs.length > 0 && m.classification !== 'inaccuracy') return 'hung_piece';
  const best = m.best_move_san ? moveMotifs(m.fen_before, m.best_move_san) : null;
  if (best?.mate) return 'missed_mate';
  if (m.classification === 'miss') return 'missed_win';
  if (best && (best.fork.length > 0 || best.threatensMate)) return 'missed_tactic';
  return null;
}

export async function playerMemory(): Promise<PlayerMemory> {
  const analyses = (await listAnalyses()).slice(0, MEMORY_GAMES);
  const games = await database().games.all();
  const byId = new Map(games.map((g) => [g.id, g]));

  const mistakeGames: Record<MistakeKind, number> = {
    allowed_mate: 0, hung_piece: 0, missed_mate: 0, missed_win: 0, missed_tactic: 0,
  };
  const phase: Record<GamePhase, { sum: number; n: number }> = {
    opening: { sum: 0, n: 0 }, middlegame: { sum: 0, n: 0 }, endgame: { sum: 0, n: 0 },
  };
  let greatFinds = 0;

  for (const analysis of analyses) {
    if (analysis.scoringVersion < SCORING_VERSION) continue;
    const game = byId.get(analysis.gameId);
    const color: Color = game?.userColor ?? 'white';

    const split = analysis.phaseSplit;
    for (const p of ['opening', 'middlegame', 'endgame'] as const) {
      const s = split?.[p];
      if (!s) continue;
      phase[p].sum += color === 'white' ? s.accuracy_white : s.accuracy_black;
      phase[p].n += 1;
    }

    const seen = new Set<MistakeKind>();
    for (const m of analysis.moves) {
      if ((m.ply % 2 === 1 ? 'white' : 'black') !== color) continue;
      if (m.classification === 'great' || m.classification === 'brilliant') greatFinds += 1;
      const kind = mistakeKind(m);
      if (kind) seen.add(kind);
    }
    for (const k of seen) mistakeGames[k] += 1;
  }

  const phaseAccuracy: Partial<Record<GamePhase, number>> = {};
  for (const p of ['opening', 'middlegame', 'endgame'] as const) {
    if (phase[p].n > 0) phaseAccuracy[p] = Math.round(phase[p].sum / phase[p].n);
  }

  return { gamesReviewed: analyses.length, mistakeGames, phaseAccuracy, greatFinds };
}

/** The phase a player plays worst, when it is clearly worse than their best. */
export function weakestPhase(
  memory: PlayerMemory,
): { weak: GamePhase; weakAcc: number; best: GamePhase; bestAcc: number } | null {
  const entries = Object.entries(memory.phaseAccuracy) as [GamePhase, number][];
  if (entries.length < 2) return null;
  entries.sort((a, b) => a[1] - b[1]);
  const [weak, weakAcc] = entries[0];
  const [best, bestAcc] = entries[entries.length - 1];
  return bestAcc - weakAcc >= 8 ? { weak, weakAcc, best, bestAcc } : null;
}

/** Whether the player got this exact position wrong in the opening trainer. */
export async function missedInTrainer(
  fenBefore: string,
): Promise<{ expected_san: string; misses: number } | null> {
  const rows = await database().openingMisses.all();
  const epd = fenToEpd(fenBefore);
  const hit = rows
    .filter((r) => fenToEpd(r.position) === epd)
    .sort((a, b) => b.misses - a.misses)[0];
  return hit ? { expected_san: hit.expectedSan, misses: hit.misses } : null;
}
