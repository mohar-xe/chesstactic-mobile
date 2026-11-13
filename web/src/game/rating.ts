// The local rating ladder.
//
// There is no server, so the rating lives on the device: one Glicko-1 rating
// per time class (bullet / blitz / rapid / daily), exactly like the pools a
// chess site keeps. The bot's rating is the Elo we handed Maia, so a rated
// game against the bot moves the ladder the same way a game against a human
// would.

import { GLICKO_DEFAULTS, PROVISIONAL_GAMES, PROVISIONAL_RD_THRESHOLD, inflateRd, updateGlicko } from '../chess/glicko';
import { classifyTimeControl } from '../chess/timeClass';
import type { RatingRecord, TimeClass } from '../chess/types';
import { database } from '../storage/db';

const DAY_MS = 86_400_000;

export function blankRating(timeClass: TimeClass): RatingRecord {
  return {
    timeClass,
    rating: GLICKO_DEFAULTS.rating,
    rd: GLICKO_DEFAULTS.rd,
    gamesPlayed: 0,
    lastPlayedAt: null,
  };
}

/** The rating for a time class, creating the default when it is unknown. */
export async function getRating(timeClass: TimeClass): Promise<RatingRecord> {
  const row = await database().ratings.get(timeClass);
  if (row) return row;
  const fresh = blankRating(timeClass);
  await database().ratings.put(fresh);
  return fresh;
}

/** All four ladders, always present. */
export async function allRatings(): Promise<RatingRecord[]> {
  const rows = await database().ratings.all();
  const map = new Map(rows.map((r) => [r.timeClass, r]));
  return (['bullet', 'blitz', 'rapid', 'daily'] as TimeClass[]).map(
    (tc) => map.get(tc) ?? blankRating(tc),
  );
}

/** The ladder a time control belongs to. */
export function ratingPoolFor(timeControl: string | null | undefined): TimeClass {
  return classifyTimeControl(timeControl) ?? 'blitz';
}

/**
 * Fold a finished rated game into the ladder.
 * `score` is 1 / 0.5 / 0 from the player's point of view.
 */
export async function recordRatedGame(args: {
  timeClass: TimeClass;
  score: 0 | 0.5 | 1;
  opponentElo: number;
  /** The bot is deterministic, so it has a tight RD. */
  opponentRd?: number;
}): Promise<{ before: RatingRecord; after: RatingRecord; delta: number }> {
  const before = await getRating(args.timeClass);
  const opponentRd = args.opponentRd ?? 40;
  const daysSinceLast = before.lastPlayedAt
    ? Math.max(0, (Date.now() - before.lastPlayedAt) / DAY_MS)
    : 0;
  const playerRd = inflateRd(before.rd, daysSinceLast);

  const update = updateGlicko({
    playerR: before.rating,
    playerRd,
    opponentR: args.opponentElo,
    opponentRd,
    score: args.score,
  });

  const after: RatingRecord = {
    timeClass: args.timeClass,
    rating: Math.round(update.newR),
    rd: Math.round(update.newRd),
    gamesPlayed: before.gamesPlayed + 1,
    lastPlayedAt: Date.now(),
  };
  await database().ratings.put(after);
  return { before, after, delta: Math.round(update.deltaR) };
}

/** Is the rating still provisional (shown with a "?")? */
export function isProvisional(rating: RatingRecord): boolean {
  return rating.gamesPlayed < PROVISIONAL_GAMES || rating.rd > PROVISIONAL_RD_THRESHOLD;
}

/** "1420?" while provisional, "1420" once settled. */
export function formatRating(rating: RatingRecord): string {
  return isProvisional(rating) ? `${rating.rating}?` : `${rating.rating}`;
}
