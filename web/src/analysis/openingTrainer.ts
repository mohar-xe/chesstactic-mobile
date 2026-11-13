// The opening trainer — a local version of the server's opening trainer.
//
// A "line" is one of the curated openings (chess/openings.ts). The trainer
// plays the opponent's half of the line and asks the player for theirs. Play
// the expected move and you continue; play something else and the trainer
// shows you the move you missed and puts it back on the board.
//
// Every miss is remembered (IndexedDB) so a line the player keeps getting
// wrong comes back on the next day, while a line played cleanly three times
// is retired.

import { Chess } from 'chess.js';
import { CURATED } from '../chess/openings';
import type { Color, OpeningMissRecord } from '../chess/types';
import { database } from '../storage/db';

/** A line is learned after this many clean repetitions. */
export const LEARNED_AFTER = 3;
/** Only lines with at least this many plies are worth drilling. */
export const MIN_TRAINER_PLIES = 8;

export interface TrainerMove {
  ply: number;
  san: string;
  uci: string;
  fenBefore: string;
  color: Color;
}

export interface TrainerLine {
  id: string;
  name: string;
  eco: string;
  sans: string[];
  moves: TrainerMove[];
}

function buildLine(line: string, eco: string, name: string): TrainerLine | null {
  const tokens = line.trim().length ? line.trim().split(/\s+/) : [];
  const chess = new Chess();
  const moves: TrainerMove[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const fenBefore = chess.fen();
    let played;
    try {
      played = chess.move(tokens[i]!, { strict: false });
    } catch {
      return null;
    }
    if (!played) return null;
    moves.push({
      ply: i + 1,
      san: played.san,
      uci: played.from + played.to + (played.promotion ?? ''),
      fenBefore,
      color: played.color === 'w' ? 'white' : 'black',
    });
  }

  return {
    id: `${eco}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name,
    eco,
    sans: tokens,
    moves,
  };
}

let cache: TrainerLine[] | null = null;

/** Every line the trainer can drill, built once and cached. */
export function trainerLines(): TrainerLine[] {
  if (cache) return cache;
  const seen = new Set<string>();
  const lines: TrainerLine[] = [];
  for (const entry of CURATED) {
    const tokens = entry.line.trim().length ? entry.line.trim().split(/\s+/) : [];
    if (tokens.length < MIN_TRAINER_PLIES) continue;
    const line = buildLine(entry.line, entry.eco, entry.name);
    if (!line) continue;
    if (seen.has(line.id)) continue;
    seen.add(line.id);
    lines.push(line);
  }
  cache = lines;
  return lines;
}

/** The line the trainer expects next, given the position and the ply count. */
export function expectedMove(line: TrainerLine, ply: number): TrainerMove | null {
  return line.moves[ply] ?? null;
}

/** The plies the player has to play in this line, for the given colour. */
export function playerPlies(line: TrainerLine, color: Color): TrainerMove[] {
  return line.moves.filter((m) => m.color === color);
}

/** The opening family ("Sicilian", "Ruy Lopez", …) — used for grouping. */
export function familyOf(line: TrainerLine): string {
  const name = line.name;
  const cut = name.indexOf(':');
  const head = cut > 0 ? name.slice(0, cut) : name;
  return head.replace(/ (Defense|Game|Opening|Gambit)$/i, '').trim() || name;
}

/* ------------------------------------------------------------- misses -- */

function missId(line: TrainerLine, ply: number, color: Color): string {
  return `${line.id}:${ply}:${color}`;
}

export interface MissEntry extends OpeningMissRecord {
  lineName: string;
}

/** Record (or reinforce) a miss on a line. */
export async function recordMiss(line: TrainerLine, ply: number, color: Color): Promise<OpeningMissRecord> {
  const id = missId(line, ply, color);
  const store = database().openingMisses;
  const existing = await store.get(id);
  const move = line.moves[ply];
  if (!move) throw new Error(`No move at ply ${ply} of ${line.name}`);

  const next: OpeningMissRecord = {
    id,
    lineName: line.name,
    userColor: color,
    moves: line.sans.slice(0, ply).join(' '),
    position: move.fenBefore,
    expectedSan: move.san,
    expectedUci: move.uci,
    misses: (existing?.misses ?? 0) + 1,
    streak: 0,
    dueOn: Date.now() + 86_400_000,
    lastReviewedAt: Date.now(),
  };
  await store.put(next);
  return next;
}

/** A clean repetition raises the streak; at LEARNED_AFTER the line is retired. */
export async function recordClean(line: TrainerLine, ply: number, color: Color): Promise<void> {
  const id = missId(line, ply, color);
  const store = database().openingMisses;
  const existing = await store.get(id);
  if (!existing) return;
  const streak = existing.streak + 1;
  if (streak >= LEARNED_AFTER) {
    await store.delete(id);
    return;
  }
  await store.put({ ...existing, streak, lastReviewedAt: Date.now() });
}

export async function listMisses(): Promise<OpeningMissRecord[]> {
  const rows = await database().openingMisses.all();
  return rows.sort((a, b) => b.misses - a.misses);
}

export async function removeMiss(id: string): Promise<void> {
  await database().openingMisses.delete(id);
}

/** Misses that are due for another look. */
export async function dueMisses(now = Date.now()): Promise<OpeningMissRecord[]> {
  const rows = await listMisses();
  return rows.filter((r) => r.dueOn <= now);
}

export interface QueueSummary {
  due: number;
  learning: number;
  learned: number;
}

export async function queueSummary(): Promise<QueueSummary> {
  const rows = await listMisses();
  const now = Date.now();
  return {
    due: rows.filter((r) => r.dueOn <= now).length,
    learning: rows.length,
    learned: 0,
  };
}
