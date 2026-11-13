// Drills built from the player's own games.
//
// A drill is the position before one of *your* mistakes, with the engine's
// line as the solution. A drill you fail comes back the next day; one you
// solve at the first try on a later day is done.

import { Chess } from 'chess.js';
import { isPuzzleMove, positionAfter, puzzleLine, type QueueState } from '../chess/gamePuzzles';
import type { AnalyzedMove, Color, DrillRecord, GameRecord } from '../chess/types';
import { database, listAnalyses } from '../storage/db';

export interface Drill {
  id: string;
  gameId: string;
  ply: number;
  fen: string;
  sideToMove: Color;
  playedSan: string;
  playedUci: string;
  bestSan: string | null;
  bestUci: string | null;
  bestPv: string[];
  /** The whole solution: yours, theirs, yours … */
  line: string[];
  lineSan: string[];
  classification: AnalyzedMove['classification'];
  centipawnLoss: number;
  review: boolean;
  due: boolean;
  solved: boolean;
}

/** The browser's calendar day, YYYY-MM-DD. */
export function localDay(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

function isDue(state: QueueState | undefined, today: string): boolean {
  if (!state) return true;
  if (state.solved === 1) return false;
  if (state.last_day !== null && state.last_day >= today) return false;
  return state.due_on === null || state.due_on <= today;
}

/** The drill's queue state, in the shape the shared queue helpers expect. */
function queueStateOf(attempt: DrillRecord | undefined): QueueState | undefined {
  if (!attempt) return undefined;
  return {
    solved: attempt.solved ? 1 : 0,
    due_on: attempt.dueOn ? new Date(attempt.dueOn).toISOString().slice(0, 10) : null,
    last_day: attempt.lastDay,
  };
}

/** Every drill the player's analysed games contain. */
export async function allDrills(): Promise<Drill[]> {
  const analyses = await listAnalyses();
  const games = await database().games.all();
  const byId = new Map(games.map((g) => [g.id, g]));
  const attempts = await database().drills.all();
  const attemptByKey = new Map(attempts.map((a) => [`${a.gameId}:${a.ply}`, a]));
  const today = localDay();

  const drills: Drill[] = [];
  for (const analysis of analyses) {
    const game = byId.get(analysis.gameId);
    if (!game) continue;
    const userColor: Color = game.userColor;
    for (const move of analysis.moves) {
      if (!isPuzzleMove(move, userColor)) continue;
      const bestUci = move.best_move_uci;
      if (!bestUci) continue;
      const line = puzzleLine(move.fen_before, bestUci, move.best_pv ?? []);
      if (line.uci.length === 0) continue;

      const attempt = attemptByKey.get(`${game.id}:${move.ply}`);
      drills.push({
        id: `${game.id}:${move.ply}`,
        gameId: game.id,
        ply: move.ply,
        fen: move.fen_before,
        sideToMove: move.ply % 2 === 1 ? 'white' : 'black',
        playedSan: move.san,
        playedUci: move.uci,
        bestSan: move.best_move_san,
        bestUci,
        bestPv: move.best_pv ?? [],
        line: line.uci,
        lineSan: line.san,
        classification: move.classification,
        centipawnLoss: move.centipawn_loss,
        review: attempt !== undefined,
        due: isDue(queueStateOf(attempt), today),
        solved: attempt?.solved === true,
      });
    }
  }
  return drills;
}

/** The next drill: a due review first, otherwise the newest unsolved one. */
export async function nextDrill(): Promise<Drill | null> {
  const drills = await allDrills();
  const due = drills.filter((d) => d.review && d.due);
  if (due.length) return due[0];
  return drills.find((d) => !d.review) ?? null;
}

/** Record the outcome of a drill attempt. */
export async function recordAttempt(
  drill: Drill,
  attemptedUci: string,
  solved: boolean,
): Promise<void> {
  const today = localDay();
  const existing = await database().drills.get(drill.id);
  const wasSolved = existing?.solved === true;
  const sameDay = existing?.lastDay === today;

  if (wasSolved || sameDay) {
    // Practice: nothing changes in the queue.
    await database().drills.put({
      ...(existing ?? blankAttempt(drill)),
      attemptedUci,
    });
    return;
  }

  await database().drills.put({
    id: drill.id,
    gameId: drill.gameId,
    ply: drill.ply,
    fen: drill.fen,
    solutionUci: drill.bestUci ?? '',
    attemptedUci,
    solved,
    dueOn: solved ? 0 : Date.parse(`${nextDay(today)}T00:00:00Z`),
    lastDay: today,
    createdAt: existing?.createdAt ?? Date.now(),
  });
}

function blankAttempt(drill: Drill): DrillRecord {
  return {
    id: drill.id,
    gameId: drill.gameId,
    ply: drill.ply,
    fen: drill.fen,
    solutionUci: drill.bestUci ?? '',
    attemptedUci: null,
    solved: false,
    dueOn: 0,
    lastDay: null,
    createdAt: Date.now(),
  };
}

/** Board position after the first `n` moves of the solution line. */
export function drillPosition(drill: Drill, n: number): string | null {
  return positionAfter(drill.fen, drill.line, n);
}

/** Is this UCI the drill's solution (the first move of the line)? */
export function isDrillSolution(drill: Drill, uci: string): boolean {
  return drill.line[0] === uci;
}

/** The move the opponent plays after the player's solution move. */
export function opponentReply(drill: Drill): string | null {
  return drill.line.length > 1 ? drill.line[1] : null;
}

/** San of a UCI move in a position. */
export function sanOf(fen: string, uci: string): string | null {
  try {
    const board = new Chess(fen);
    const m = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
    return m?.san ?? null;
  } catch {
    return null;
  }
}

export function drillStats(drills: Drill[]): { total: number; solved: number; due: number } {
  return {
    total: drills.length,
    solved: drills.filter((d) => d.solved).length,
    due: drills.filter((d) => d.due && !d.solved).length,
  };
}

export type { GameRecord };
