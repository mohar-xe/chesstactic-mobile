// Shared types for the local-first app. Everything lives on the device.

export type Color = 'white' | 'black';
export type Classification =
  | 'brilliant' | 'great' | 'best' | 'excellent' | 'good' | 'book' | 'forced'
  | 'inaccuracy' | 'mistake' | 'blunder' | 'miss';

export const CLASSIFICATIONS: Classification[] = [
  'brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced',
  'inaccuracy', 'mistake', 'blunder', 'miss',
];

export type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'daily';
export type GameSource = 'played' | 'imported' | 'pasted';
export type EngineTierId = 'maia3-5m' | 'maia3-23m' | 'maia3-79m';

export interface AnalyzedMove {
  ply: number;
  san: string;
  uci: string;
  fen_before: string;
  fen_after: string;
  eval_before_cp: number | null;
  eval_after_cp: number | null;
  mate_before: number | null;
  mate_after: number | null;
  best_move_uci: string | null;
  best_move_san: string | null;
  best_pv: string[];
  centipawn_loss: number;
  classification: Classification;
  /** Probability (0..1) that a human of the player's own rating would play
   *  this move. Filled by the Maia-3 pass, `null` when the model is absent. */
  human_probability: number | null;
}

export type GamePhase = 'opening' | 'middlegame' | 'endgame';

export interface PhaseSplit {
  opening: PhaseSlice | null;
  middlegame: PhaseSlice | null;
  endgame: PhaseSlice | null;
}

export interface PhaseSlice {
  from_ply: number;
  to_ply: number;
  accuracy_white: number;
  accuracy_black: number;
  acpl_white: number;
  acpl_black: number;
}

export interface KeyMomentSummary {
  ply: number;
  side: Color;
  san: string;
  fen_before: string;
  classification: Classification;
  cp_loss: number;
  win_pct_delta: number;
  best_san: string | null;
  best_pv: string[];
}

/** A finished game as stored on the device. */
export interface GameRecord {
  id: string;
  source: GameSource;
  pgn: string;
  fen: string;
  moves: string[];
  result: string;
  white: string;
  black: string;
  userColor: Color;
  timeControl: string;
  timeClass: TimeClass;
  endedAt: number;
  /** Bot the game was played against (model id + target Elo). */
  opponentModel?: EngineTierId | null;
  opponentElo?: number | null;
  /** True when the game was rated for the local ladder. */
  rated?: boolean;
  eco?: string | null;
  openingName?: string | null;
  bookmarked?: boolean;
  notes?: string;
}

/** Engine analysis of a game, keyed by game id. */
export interface AnalysisRecord {
  gameId: string;
  depth: number;
  moves: AnalyzedMove[];
  accuracyWhite: number;
  accuracyBlack: number;
  estimatedEloWhite: number | null;
  estimatedEloBlack: number | null;
  performanceWhite: number | null;
  performanceBlack: number | null;
  openingEco: string | null;
  openingName: string | null;
  keyMoments: KeyMomentSummary[];
  phaseSplit: PhaseSplit | null;
  scoredAt: number;
  scoringVersion: number;
}

/** A drill built from one of the player's own mistakes. */
export interface DrillRecord {
  id: string;
  gameId: string;
  ply: number;
  fen: string;
  solutionUci: string;
  attemptedUci: string | null;
  solved: boolean;
  dueOn: number;
  lastDay: string | null;
  createdAt: number;
}

/** An opening line the player got wrong in the trainer. */
export interface OpeningMissRecord {
  id: string;
  lineName: string;
  userColor: Color;
  moves: string;
  position: string;
  expectedSan: string;
  expectedUci: string;
  misses: number;
  streak: number;
  dueOn: number;
  lastReviewedAt: number | null;
}

export interface LessonProgressRecord {
  lessonId: string;
  step: number;
  /** How many tasks were solved sloppily — fewer flaws, more stars. */
  flawed: number;
  stars: number;
  completedAt: number | null;
  updatedAt: number;
}

/** Local ladder rating per time class. */
export interface RatingRecord {
  timeClass: TimeClass;
  rating: number;
  rd: number;
  gamesPlayed: number;
  lastPlayedAt: number | null;
}

export interface LocalProfile {
  displayName: string;
  avatarEmoji: string;
  boardTheme: string;
  soundEnabled: boolean;
  moveSoundSet: 'classic' | 'board';
  siteTheme: 'auto' | 'light' | 'dark';
  ttsEnabled: boolean;
  ttsVoice: string | null;
  ttsRate: number;
  ttsPitch: number;
  blunderWarning: boolean;
  kidMode: boolean;
  chesscomUsername: string | null;
  lichessUsername: string | null;
  engineTier: EngineTierId;
  /** Target Elo for the opponent when adaptive mode is off. */
  botElo: number;
  /** Let the bot track the local rating automatically. */
  adaptiveBot: boolean;
  /** Depth used by the bundled Stockfish when reviewing games. */
  analysisDepth: number;
  /** Extra models the user has downloaded. */
  installedModels: string[];
}

export const DEFAULT_PROFILE: LocalProfile = {
  displayName: 'Player',
  avatarEmoji: '♞',
  boardTheme: 'green',
  soundEnabled: true,
  moveSoundSet: 'classic',
  siteTheme: 'auto',
  ttsEnabled: false,
  ttsVoice: null,
  ttsRate: 1,
  ttsPitch: 1,
  blunderWarning: true,
  kidMode: false,
  chesscomUsername: null,
  lichessUsername: null,
  engineTier: 'maia3-23m',
  botElo: 1400,
  adaptiveBot: true,
  analysisDepth: 12,
  installedModels: [],
};
