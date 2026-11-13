// Human-aligned review — the review that works everywhere.
//
// The Stockfish path (analysis/review.ts) is the "ground truth" review, but
// Stockfish only ships inside the Android app. This module produces a review
// with nothing but Maia-3, so the same feature works in a browser and on a
// phone without a 40 MB engine binary.
//
// The idea: Maia tells us how likely a *human of the player's rating* is to
// play a given move. The move you played that your rating would have chosen
// is the move you should have played — everything else is a miss, graded by
// how big a chance you gave away.

import { Chess } from 'chess.js';
import { gameAccuracy, type MoveAccPoint } from '../chess/accuracy';
import { extractKeyMoments } from '../chess/keyMoments';
import { lookupOpeningFromPgn } from '../chess/openings';
import { startFenOf } from '../chess/startFen';
import { SCORING_VERSION } from '../chess/classifier';
import type {
  AnalysisRecord, AnalyzedMove, Color, GameRecord, KeyMomentSummary,
} from '../chess/types';
import type { MaiaEngine } from '../engine/maia3';

export interface MaiaReviewOptions {
  /** The player's own rating — drives how Maia plays in the review. */
  playerElo?: number;
  /** Skip the second (post-move) evaluation for cheap reviews. */
  fast?: boolean;
  onProgress?: (done: number, total: number) => void;
}

/** Win probability of the side to move, 0..100. */
function winPctFromWdl(wdl: { win: number; draw: number; loss: number }): number {
  return wdl.win + wdl.draw / 2;
}

/** A win-probability difference turned into a rough centipawn loss. */
function winDropToCp(drop: number): number {
  return Math.round(drop * 22);
}

function classify(p: number, winDrop: number): AnalyzedMove['classification'] {
  if (p >= 0.5) return winDrop >= 12 ? 'excellent' : 'best';
  if (p >= 0.25) return winDrop >= 12 ? 'good' : 'excellent';
  if (p >= 0.1) return winDrop >= 12 ? 'inaccuracy' : 'good';
  if (p >= 0.03) return winDrop >= 14 ? 'mistake' : 'inaccuracy';
  if (p >= 0.005) return 'mistake';
  return 'blunder';
}

function perMoveAccuracy(p: number): number {
  const scaled = Math.sqrt(Math.min(1, p / 0.55));
  return Math.max(0, Math.min(100, scaled * 100));
}

export async function reviewGameWithMaia(
  game: GameRecord,
  maia: MaiaEngine,
  options: MaiaReviewOptions = {},
): Promise<AnalysisRecord> {
  const elo = options.playerElo ?? 1400;
  const previous = maia.currentSettings;
  maia.update({ selfElo: elo, oppoElo: elo, temperature: 0, topP: 1 });

  const chess = new Chess();
  try {
    chess.loadPgn(game.pgn, { strict: false });
  } catch {
    /* keep the moves we could parse */
  }
  const history = chess.history({ verbose: true });
  const replay = new Chess(startFenOf(chess, game.pgn));

  const moves: AnalyzedMove[] = [];
  const positionHistory: string[] = [];

  const whitePoints: MoveAccPoint[] = [];
  const blackPoints: MoveAccPoint[] = [];
  let whiteCplSum = 0, whiteCplN = 0;
  let blackCplSum = 0, blackCplN = 0;

  for (let i = 0; i < history.length; i += 1) {
    const played = history[i]!;
    const fenBefore = replay.fen();
    const sideToMove: Color = replay.turn() === 'w' ? 'white' : 'black';

    const legal = replay.moves({ verbose: true }).map((m) => ({
      uci: m.from + m.to + (m.promotion ?? ''),
      san: m.san,
    }));
    const uci = played.from + played.to + (played.promotion ?? '');

    let prediction = null;
    try {
      prediction = await maia.predict(fenBefore, positionHistory, legal);
    } catch {
      prediction = null;
    }

    const candidate = prediction?.candidates.find((c) => c.uci === uci);
    const probability = candidate?.probability ?? 0;
    const best = prediction?.candidates[0] ?? null;

    const moverWinBefore = prediction ? winPctFromWdl(prediction.wdl) : 50;

    replay.move({ from: played.from, to: played.to, promotion: played.promotion });
    const fenAfter = replay.fen();

    let moverWinAfter = moverWinBefore;
    if (prediction && !(options.fast && probability >= 0.35)) {
      const replyLegal = replay.moves({ verbose: true }).map((m) => ({
        uci: m.from + m.to + (m.promotion ?? ''),
        san: m.san,
      }));
      try {
        const after = await maia.predict(fenAfter, [...positionHistory, fenBefore], replyLegal);
        // The value head is from the side to move — the opponent now.
        moverWinAfter = 100 - winPctFromWdl(after.wdl);
      } catch {
        moverWinAfter = moverWinBefore;
      }
    } else if (prediction) {
      moverWinAfter = Math.max(0, moverWinBefore - (1 - probability) * 6);
    }

    const winDrop = Math.max(0, moverWinBefore - moverWinAfter);
    const cls = classify(probability, winDrop);
    const isBook = cls === 'book' || (probability >= 0.9 && winDrop < 1);

    const whiteWinPct = sideToMove === 'white' ? moverWinAfter : 100 - moverWinAfter;
    const point: MoveAccPoint = {
      acc: perMoveAccuracy(probability),
      winPct: whiteWinPct,
      isBook,
    };
    const cpLoss = isBook ? 0 : winDropToCp(winDrop);

    if (sideToMove === 'white') {
      whitePoints.push(point);
      if (!isBook) { whiteCplSum += cpLoss; whiteCplN += 1; }
    } else {
      blackPoints.push(point);
      if (!isBook) { blackCplSum += cpLoss; blackCplN += 1; }
    }

    moves.push({
      ply: i + 1,
      san: played.san,
      uci,
      fen_before: fenBefore,
      fen_after: fenAfter,
      eval_before_cp: Math.round((moverWinBefore - 50) * 22),
      eval_after_cp: Math.round((moverWinAfter - 50) * 22),
      mate_before: null,
      mate_after: null,
      best_move_uci: best?.uci ?? null,
      best_move_san: best?.san ?? null,
      best_pv: best ? [best.san] : [],
      centipawn_loss: cpLoss,
      classification: cls,
      human_probability: probability,
    });

    positionHistory.push(fenBefore);
    options.onProgress?.(i + 1, history.length);
  }

  maia.update({ selfElo: previous.selfElo, oppoElo: previous.oppoElo, temperature: previous.temperature, topP: previous.topP });

  const accuracyWhite = Math.round(gameAccuracy(whitePoints) * 10) / 10;
  const accuracyBlack = Math.round(gameAccuracy(blackPoints) * 10) / 10;
  const acplWhite = whiteCplN ? whiteCplSum / whiteCplN : 0;
  const acplBlack = blackCplN ? blackCplSum / blackCplN : 0;

  const opening = lookupOpeningFromPgn(game.pgn);
  const keyMoments: KeyMomentSummary[] = extractKeyMoments(moves, 5).map((m) => ({
    ply: m.ply,
    side: m.side,
    san: m.san,
    fen_before: m.fen_before,
    classification: m.classification,
    cp_loss: m.cp_loss,
    win_pct_delta: m.win_pct_delta,
    best_san: m.best_san,
    best_pv: m.best_pv,
  }));

  return {
    gameId: game.id,
    depth: 0,
    moves,
    accuracyWhite,
    accuracyBlack,
    estimatedEloWhite: whitePoints.length ? Math.round(1200 + (accuracyWhite - 50) * 12) : null,
    estimatedEloBlack: blackPoints.length ? Math.round(1200 + (accuracyBlack - 50) * 12) : null,
    performanceWhite: null,
    performanceBlack: null,
    openingEco: opening?.eco ?? null,
    openingName: opening?.name ?? null,
    keyMoments,
    phaseSplit: null,
    scoredAt: Date.now(),
    scoringVersion: SCORING_VERSION,
  };
}
