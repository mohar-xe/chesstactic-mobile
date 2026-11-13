// Post-game review, computed on the device.
//
// This is the port of the server's `analyzePgnFull`: it walks the game ply by
// ply, asks the engine for the position's evaluation before and after each
// move, and turns the centipawn loss into chess.com-style classifications.
//
// Two engines can contribute:
//   * Stockfish (bundled on Android) — the honest judgement of a mistake.
//   * Maia-3 — what a *human* of the player's rating would have played. That
//     is the layer that makes the review human-aligned rather than
//     engine-aligned.

import { Chess } from 'chess.js';
import {
  BOOK_PLIES, SCORING_VERSION, classifyByWpDrop, cpLossForAcpl, cpLossForPly,
  cpToWinPct, estimateElo, estimateGamePerformance, moveAccuracy, normalizeEval,
  refineClassification, winDropForPly,
} from '../chess/classifier';
import { gameAccuracy, type MoveAccPoint } from '../chess/accuracy';
import { extractKeyMoments } from '../chess/keyMoments';
import { fenToEpd, lookupOpeningByEpd, lookupOpeningFromPgn } from '../chess/openings';
import { startFenOf } from '../chess/startFen';
import type {
  AnalysisRecord, AnalyzedMove, Color, GameRecord, KeyMomentSummary, PhaseSplit,
} from '../chess/types';
import type { StockfishClient } from '../engine/stockfish/client';
import type { MaiaEngine } from '../engine/maia3';

export interface PerformanceContext {
  /** 1 = win, 0 = loss, 0.5 = draw, null = unknown. */
  score: number | null;
  userColor: Color;
  opponentRating: number | null;
  opponentRd: number | null;
}

export interface ReviewOptions {
  depth?: number;
  performance?: PerformanceContext;
  /** The player's own rating, used for the human-aligned Maia pass. */
  playerElo?: number | null;
  /** Skip the Maia pass (it costs one model run per ply). */
  skipHumanPass?: boolean;
  onProgress?: (done: number, total: number) => void;
}

export class ReviewUnavailableError extends Error {
  constructor() {
    super('Stockfish is not available on this device');
  }
}

export async function reviewGame(
  game: GameRecord,
  stockfish: StockfishClient,
  maia: MaiaEngine | null,
  options: ReviewOptions = {},
): Promise<AnalysisRecord> {
  if (!stockfish.available) throw new ReviewUnavailableError();

  const depth = options.depth ?? 12;
  const perf = options.performance ?? {
    score: null,
    userColor: game.userColor,
    opponentRating: null,
    opponentRd: null,
  };

  const chess = new Chess();
  chess.loadPgn(game.pgn, { strict: false });
  const history = chess.history({ verbose: true });

  const replay = new Chess(startFenOf(chess, game.pgn));
  const moves: AnalyzedMove[] = [];

  let prevEval = await evaluate(stockfish, replay.fen(), depth, 3);
  let prevWhiteCp = normalizeEval(prevEval.cp, prevEval.mate, replay.turn());

  const whitePoints: MoveAccPoint[] = [];
  const blackPoints: MoveAccPoint[] = [];
  let whiteCplSum = 0, whiteCplN = 0;
  let blackCplSum = 0, blackCplN = 0;

  let stillInBook = true;
  const positionHistory: string[] = [];

  for (let i = 0; i < history.length; i += 1) {
    const move = history[i];
    if (!move) continue;
    const sideToMove: Color = replay.turn() === 'w' ? 'white' : 'black';
    const fenBefore = replay.fen();
    const bestUci = prevEval.bestMove;

    const bestSan = bestUci ? sanOf(fenBefore, bestUci) : null;
    const pvSan = pvSanOf(fenBefore, prevEval.pv);
    const legalMoveCount = new Chess(fenBefore).moves().length;

    const candidatePlayerCps = (prevEval.candidates ?? []).map((cand) => {
      if (cand.mate !== null) return cand.mate > 0 ? 10000 - cand.mate * 10 : -10000 - cand.mate * 10;
      return cand.cp ?? 0;
    });

    replay.move({ from: move.from, to: move.to, promotion: move.promotion });
    const fenAfter = replay.fen();

    const nextEval = await evaluate(stockfish, fenAfter, depth, 3);
    const nextWhiteCp = normalizeEval(nextEval.cp, nextEval.mate, replay.turn());

    const wpBefore = cpToWinPct(prevWhiteCp);
    const wpAfter = cpToWinPct(nextWhiteCp);
    const playerWinBefore = sideToMove === 'white' ? wpBefore : 100 - wpBefore;
    const playerWinAfter = sideToMove === 'white' ? wpAfter : 100 - wpAfter;

    const playerEvalBeforeCp = sideToMove === 'white' ? prevWhiteCp : -prevWhiteCp;
    const playerEvalAfterCp = sideToMove === 'white' ? nextWhiteCp : -nextWhiteCp;
    const cpLoss = cpLossForPly(playerEvalBeforeCp, playerEvalAfterCp);
    const cpLossAcpl = cpLossForAcpl(playerEvalBeforeCp, playerEvalAfterCp);

    const mateBefore = prevEval.mate !== null
      ? (sideToMove === 'white' ? prevEval.mate : -prevEval.mate)
      : null;
    const mateAfter = nextEval.mate !== null
      ? (sideToMove === 'white' ? -nextEval.mate : nextEval.mate)
      : null;

    const wpDrop = winDropForPly(playerEvalBeforeCp, playerEvalAfterCp, playerWinBefore, playerWinAfter);
    const uci = move.from + move.to + (move.promotion ?? '');
    const isBest = bestUci === uci;
    const baseCls = classifyByWpDrop(wpDrop, cpLoss, isBest);

    let inBookEpd = false;
    if (stillInBook) {
      if (lookupOpeningByEpd(fenToEpd(fenBefore))) inBookEpd = true;
      else stillInBook = false;
    }
    if (i + 1 > 20) inBookEpd = false;

    const cls = refineClassification({
      base: baseCls,
      isBest,
      cpLoss,
      fenBefore,
      fenAfter,
      sideToMove,
      playerEvalBeforeCp,
      playerEvalAfterCp,
      ply: i + 1,
      legalMoveCount,
      candidatePlayerCps,
      pvAfterPlayed: nextEval.pv,
      inBook: inBookEpd,
    });

    const excludeFromAggregate = cls === 'book' || cls === 'forced';
    const acc = moveAccuracy(playerWinBefore, playerWinBefore - wpDrop);
    const point: MoveAccPoint = { acc, winPct: playerWinAfter, isBook: excludeFromAggregate };
    if (sideToMove === 'white') {
      whitePoints.push(point);
      if (!excludeFromAggregate) { whiteCplSum += cpLossAcpl; whiteCplN += 1; }
    } else {
      blackPoints.push(point);
      if (!excludeFromAggregate) { blackCplSum += cpLossAcpl; blackCplN += 1; }
    }

    // Human-aligned pass: would a player of this rating have played this?
    let humanProbability: number | null = null;
    if (maia && !options.skipHumanPass && sideToMove === perf.userColor) {
      humanProbability = await humanProbabilityOf(maia, fenBefore, positionHistory, uci, options.playerElo ?? 1400);
    }
    positionHistory.push(fenBefore);

    moves.push({
      ply: i + 1,
      san: move.san,
      uci,
      fen_before: fenBefore,
      fen_after: fenAfter,
      eval_before_cp: prevWhiteCp,
      eval_after_cp: nextWhiteCp,
      mate_before: mateBefore,
      mate_after: mateAfter,
      best_move_uci: bestUci,
      best_move_san: bestSan,
      best_pv: pvSan,
      centipawn_loss: cpLoss,
      classification: cls,
      human_probability: humanProbability,
    });

    prevEval = nextEval;
    prevWhiteCp = nextWhiteCp;
    options.onProgress?.(i + 1, history.length);
  }

  const accuracyWhite = Math.round(gameAccuracy(whitePoints) * 10) / 10;
  const accuracyBlack = Math.round(gameAccuracy(blackPoints) * 10) / 10;
  const acplWhite = whiteCplN ? whiteCplSum / whiteCplN : 0;
  const acplBlack = blackCplN ? blackCplSum / blackCplN : 0;

  const estimatedEloWhite = whitePoints.length ? estimateElo(accuracyWhite, acplWhite) : null;
  const estimatedEloBlack = blackPoints.length ? estimateElo(accuracyBlack, acplBlack) : null;

  let performanceWhite: number | null = null;
  let performanceBlack: number | null = null;
  if (perf.score !== null) {
    const userPerf = estimateGamePerformance({
      accuracy: perf.userColor === 'white' ? accuracyWhite : accuracyBlack,
      acpl: perf.userColor === 'white' ? acplWhite : acplBlack,
      opponentRating: perf.opponentRating,
      opponentRd: perf.opponentRd,
      score: toScore(perf.score),
    });
    if (perf.userColor === 'white') performanceWhite = userPerf;
    else performanceBlack = userPerf;
  }
  if (performanceWhite === null && whitePoints.length) {
    performanceWhite = estimateGamePerformance({
      accuracy: accuracyWhite, acpl: acplWhite, opponentRating: null, opponentRd: null, score: toScore(perf.score ?? 0.5),
    });
  }
  if (performanceBlack === null && blackPoints.length) {
    performanceBlack = estimateGamePerformance({
      accuracy: accuracyBlack, acpl: acplBlack, opponentRating: null, opponentRd: null, score: toScore(perf.score ?? 0.5),
    });
  }

  const opening = lookupOpeningFromPgn(game.pgn);
  const phaseSplit = computePhaseSplit(moves, opening?.plies ?? 0);
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
    depth,
    moves,
    accuracyWhite,
    accuracyBlack,
    estimatedEloWhite,
    estimatedEloBlack,
    performanceWhite,
    performanceBlack,
    openingEco: opening?.eco ?? null,
    openingName: opening?.name ?? null,
    keyMoments,
    phaseSplit,
    scoredAt: Date.now(),
    scoringVersion: SCORING_VERSION,
  };
}

/* --------------------------------------------------------------- helpers */

/** A game score as the classifier wants it: 1, 0.5 or 0. */
function toScore(score: number | null): 0 | 0.5 | 1 {
  if (score === null || !Number.isFinite(score)) return 0.5;
  if (score >= 0.75) return 1;
  if (score <= 0.25) return 0;
  return 0.5;
}

interface EvalLine {
  cp: number;
  mate: number | null;
  pv: string[];
  bestMove: string | null;
  candidates: { cp: number | null; mate: number | null }[];
}

async function evaluate(
  stockfish: StockfishClient,
  fen: string,
  depth: number,
  multiPv: number,
): Promise<EvalLine> {
  const lines = await stockfish.analyze(fen, { depth, multiPv });
  if (!lines.length) return { cp: 0, mate: null, pv: [], bestMove: null, candidates: [] };
  const first = lines[0];
  return {
    cp: first.cp,
    mate: first.mate,
    pv: first.pv,
    bestMove: first.bestMove,
    candidates: lines.map((l) => ({ cp: l.cp, mate: l.mate })),
  };
}

function sanOf(fen: string, uci: string): string | null {
  try {
    const probe = new Chess(fen);
    const m = probe.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.slice(4) || undefined,
    });
    return m?.san ?? null;
  } catch {
    return null;
  }
}

function pvSanOf(fen: string, pv: string[]): string[] {
  const out: string[] = [];
  if (!pv.length) return out;
  try {
    const probe = new Chess(fen);
    for (const u of pv.slice(0, 6)) {
      const m = probe.move({
        from: u.slice(0, 2),
        to: u.slice(2, 4),
        promotion: u.slice(4) || undefined,
      });
      if (!m) break;
      out.push(m.san);
    }
  } catch {
    /* ignore malformed pv */
  }
  return out;
}

/** Probability that a human of `elo` plays `uci` in this position. */
async function humanProbabilityOf(
  maia: MaiaEngine,
  fen: string,
  previousFens: string[],
  uci: string,
  elo: number,
): Promise<number | null> {
  try {
    const board = new Chess(fen);
    const legal = board.moves({ verbose: true }).map((m) => ({
      uci: m.from + m.to + (m.promotion ?? ''),
      san: m.san,
    }));
    const previous = maia.currentSettings;
    maia.update({ selfElo: elo, oppoElo: elo });
    const prediction = await maia.predict(fen, previousFens, legal);
    maia.update({ selfElo: previous.selfElo, oppoElo: previous.oppoElo });
    const match = prediction.candidates.find((c) => c.uci === uci);
    return match?.probability ?? null;
  } catch {
    return null;
  }
}

export function computePhaseSplit(moves: AnalyzedMove[], openingPlies: number): PhaseSplit {
  const totalPlies = moves.length;
  if (totalPlies === 0) return { opening: null, middlegame: null, endgame: null };

  const openingTo = Math.min(totalPlies, Math.max(BOOK_PLIES, openingPlies || BOOK_PLIES));

  let endgameFrom = totalPlies + 1;
  for (let i = 0; i < moves.length; i += 1) {
    const fen = moves[i].fen_after.split(' ')[0] ?? '';
    let whiteMin = 0, whiteRook = 0, whiteQueen = 0;
    let blackMin = 0, blackRook = 0, blackQueen = 0;
    for (const ch of fen) {
      if (ch === '/' || /\d/.test(ch)) continue;
      if (ch === 'N' || ch === 'B') whiteMin += 1;
      else if (ch === 'R') whiteRook += 1;
      else if (ch === 'Q') whiteQueen += 1;
      else if (ch === 'n' || ch === 'b') blackMin += 1;
      else if (ch === 'r') blackRook += 1;
      else if (ch === 'q') blackQueen += 1;
    }
    const nonPawnMaterial =
      (whiteMin * 3 + whiteRook * 5 + whiteQueen * 9) +
      (blackMin * 3 + blackRook * 5 + blackQueen * 9);
    const noQueens = whiteQueen === 0 && blackQueen === 0;
    if (nonPawnMaterial <= 26 && (noQueens || nonPawnMaterial <= 16)) {
      endgameFrom = i + 1;
      break;
    }
  }

  const middleFrom = openingTo + 1;
  const middleTo = Math.min(totalPlies, endgameFrom - 1);

  function summarize(fromPly: number, toPly: number) {
    if (fromPly > toPly) return null;
    const slice = moves.filter((m) => m.ply >= fromPly && m.ply <= toPly);
    if (slice.length < 4) return null;
    const wPoints: MoveAccPoint[] = [];
    const bPoints: MoveAccPoint[] = [];
    let wAcpl = 0, wN = 0, bAcpl = 0, bN = 0;
    for (const m of slice) {
      const isWhite = m.ply % 2 === 1;
      const isBook = m.classification === 'book';
      const wpBeforeWhite = cpToWinPct(m.eval_before_cp ?? 0);
      const wpAfterWhite = cpToWinPct(m.eval_after_cp ?? 0);
      const wpBefore = isWhite ? wpBeforeWhite : 100 - wpBeforeWhite;
      const wpAfter = isWhite ? wpAfterWhite : 100 - wpAfterWhite;
      const playerEvalBefore = isWhite ? (m.eval_before_cp ?? 0) : -(m.eval_before_cp ?? 0);
      const playerEvalAfter = isWhite ? (m.eval_after_cp ?? 0) : -(m.eval_after_cp ?? 0);
      const wpDrop = winDropForPly(playerEvalBefore, playerEvalAfter, wpBefore, wpAfter);
      const acc = moveAccuracy(wpBefore, wpBefore - wpDrop);
      const point: MoveAccPoint = { acc, winPct: wpAfter, isBook };
      if (isWhite) {
        wPoints.push(point);
        if (!isBook) { wAcpl += m.centipawn_loss; wN += 1; }
      } else {
        bPoints.push(point);
        if (!isBook) { bAcpl += m.centipawn_loss; bN += 1; }
      }
    }
    return {
      from_ply: fromPly,
      to_ply: toPly,
      accuracy_white: Math.round(gameAccuracy(wPoints) * 10) / 10,
      accuracy_black: Math.round(gameAccuracy(bPoints) * 10) / 10,
      acpl_white: wN ? Math.round(wAcpl / wN) : 0,
      acpl_black: bN ? Math.round(bAcpl / bN) : 0,
    };
  }

  return {
    opening: summarize(1, openingTo),
    middlegame: summarize(middleFrom, middleTo),
    endgame: endgameFrom <= totalPlies ? summarize(endgameFrom, totalPlies) : null,
  };
}
