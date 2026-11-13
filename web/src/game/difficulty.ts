// The bot's difficulty.
//
// Maia-3 is a *human-like* model: it does not have a skill level slider like
// Stockfish. Instead you tell it how strong the two sides are and it plays
// like a player of that strength. So "difficulty" here means "which Elo do we
// tell Maia the opponent (and itself) is".
//
// The mapping between a Maia Elo tier and the visible difficulty label is
// deliberately coarse: the point is a human opponent, not a precise strength.

import type { EngineTierId } from '../chess/types';

export type DifficultyId = 'beginner' | 'casual' | 'intermediate' | 'advanced' | 'strong';

export interface DifficultyTier {
  id: DifficultyId;
  label: string;
  /** Elo we hand to Maia as the player's rating. */
  playerElo: number;
  /** Elo we hand to Maia as the bot's rating. */
  botElo: number;
  /** What the tier is meant to feel like. */
  blurb: string;
}

export const DIFFICULTY_TIERS: DifficultyTier[] = [
  { id: 'beginner', label: 'Beginner', playerElo: 600, botElo: 700, blurb: 'Plays like a club beginner. Blunders often.' },
  { id: 'casual', label: 'Casual', playerElo: 900, botElo: 1000, blurb: 'A relaxed regular. Misses simple tactics.' },
  { id: 'intermediate', label: 'Intermediate', playerElo: 1200, botElo: 1300, blurb: 'Solid club player. Punishes loose pieces.' },
  { id: 'advanced', label: 'Advanced', playerElo: 1500, botElo: 1600, blurb: 'Tournament player. Rarely gives anything away.' },
  { id: 'strong', label: 'Strong', playerElo: 1900, botElo: 2000, blurb: 'Very strong human. Expect no gifts.' },
];

export const DEFAULT_DIFFICULTY: DifficultyId = 'intermediate';

export function difficultyTier(id: DifficultyId): DifficultyTier {
  return DIFFICULTY_TIERS.find((t) => t.id === id) ?? DIFFICULTY_TIERS[2]!;
}

/**
 * The Elo we want the bot to play at.
 *
 * With the adaptive opponent on, the bot tracks the player's local rating but
 * never gets far away from it — a bot that is 400 Elo stronger stops feeling
 * human and starts feeling like an engine. The handicap is capped so the
 * ladder can still move.
 */
export function adaptiveBotElo(playerRating: number, tier: DifficultyTier): number {
  const anchored = Math.round(tier.botElo * 0.5 + playerRating * 0.5);
  const ceiling = tier.botElo + 250;
  const floor = tier.botElo - 250;
  return Math.max(600, Math.min(5000, Math.max(floor, Math.min(ceiling, anchored))));
}

/** The Elo we tell Maia the *player* has (this drives the bot's style). */
export function playerEloFor(rating: number, tier: DifficultyTier): number {
  if (rating > 0) return Math.max(400, Math.min(5000, Math.round(rating)));
  return tier.playerElo;
}

/** Sampling temperature per tier — weaker bots should play sloppier. */
export function temperatureFor(id: DifficultyId): number {
  switch (id) {
    case 'beginner': return 1.15;
    case 'casual': return 1.05;
    case 'intermediate': return 0.95;
    case 'advanced': return 0.8;
    case 'strong': return 0.6;
    default: return 0.95;
  }
}

/** Nucleus sampling threshold per tier. */
export function topPFor(id: DifficultyId): number {
  switch (id) {
    case 'beginner': return 0.95;
    case 'casual': return 0.9;
    case 'intermediate': return 0.85;
    case 'advanced': return 0.75;
    case 'strong': return 0.6;
    default: return 0.85;
  }
}

/** The Elo band each model can realistically imitate. */
export const MODEL_ELO_RANGE: Record<EngineTierId, [number, number]> = {
  'maia3-5m': [600, 1600],
  'maia3-23m': [700, 2200],
  'maia3-79m': [700, 2800],
};

/** Clamp a requested Elo into what the model can plausibly play. */
export function clampEloForModel(modelId: EngineTierId, elo: number): number {
  const [lo, hi] = MODEL_ELO_RANGE[modelId];
  return Math.max(lo, Math.min(hi, Math.round(elo)));
}
