import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Key } from 'chessground/types';
import ChessBoard from '../components/ChessBoard';
import MoveList from '../components/MoveList';
import EvalBar from '../components/EvalBar';
import AccuracyDonut from '../components/AccuracyDonut';
import ClassificationStats from '../components/ClassificationStats';
import KeyMomentsList from '../components/KeyMomentsList';
import MoveExplanation from '../components/MoveExplanation';
import { getAnalysis, getGame } from '../storage/db';
import type { AnalysisRecord, GameRecord } from '../chess/types';

export default function GameAnalyzer() {
  const { id } = useParams<{ id: string }>();
  const [game, setGame] = useState<GameRecord | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisRecord | null>(null);
  const [ply, setPly] = useState(0);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    void (async () => {
      const record = await getGame(id);
      const analysisRecord = await getAnalysis(id);
      if (!alive) return;
      if (!record) {
        setMissing(true);
        return;
      }
      setGame(record);
      setAnalysis(analysisRecord ?? null);
    })();
    return () => { alive = false; };
  }, [id]);

  const moves = analysis?.moves ?? [];

  const fen = useMemo(() => {
    if (!game) return '';
    if (moves.length === 0) return game.fen;
    if (ply === 0) return moves[0]!.fen_before;
    const index = Math.min(ply, moves.length) - 1;
    return moves[index]!.fen_after;
  }, [game, moves, ply]);

  const selected = moves.length > 0 ? moves[Math.max(0, Math.min(ply, moves.length) - 1)] ?? null : null;
  const lastMove = useMemo(() => {
    if (!selected) return undefined;
    return [selected.uci.slice(0, 2), selected.uci.slice(2, 4)] as [Key, Key];
  }, [selected]);

  if (missing) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold">Game not found</h1>
        <Link to="/review" className="text-sm text-[#ffc934] hover:underline">← Back to the game list</Link>
      </div>
    );
  }

  if (!game) {
    return <div className="p-8 text-sm text-slate-500">Loading…</div>;
  }

  const userIsWhite = game.userColor === 'white';
  const userAccuracy = userIsWhite ? analysis?.accuracyWhite : analysis?.accuracyBlack;
  const opponentAccuracy = userIsWhite ? analysis?.accuracyBlack : analysis?.accuracyWhite;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{game.white} vs {game.black}</h1>
          <p className="text-sm text-slate-400">
            {game.result} · {game.timeControl} · {new Date(game.endedAt).toLocaleDateString()}
            {analysis?.openingName ? ` · ${analysis.openingName}` : ''}
          </p>
        </div>
        <Link to="/review" className="text-sm text-[#ffc934] hover:underline">← All games</Link>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1 overflow-hidden rounded-xl bg-[#312e2b] p-2">
              <EvalBar cp={selected?.eval_before_cp ?? null} mate={selected?.mate_before ?? null} height={320} />
            </div>
            <div className="flex-1 rounded-xl bg-[#312e2b] p-2">
              <ChessBoard
                fen={fen}
                orientation={game.userColor}
                movable={false}
                lastMove={lastMove}
              />
            </div>
          </div>

          {selected && (
            <MoveExplanation move={selected} userColor={game.userColor} />
          )}
        </div>

        <aside className="space-y-3">
          {analysis ? (
            <>
              <div className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <div className="flex-1 text-center">
                  <AccuracyDonut value={userAccuracy} label="You" showBand />
                </div>
                <div className="flex-1 text-center">
                  <AccuracyDonut value={opponentAccuracy} label="Opponent" showBand />
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <MoveList
                  moves={moves.map((m) => ({ ply: m.ply, san: m.san, classification: m.classification }))}
                  current={ply}
                  onSelect={setPly}
                  phaseSplit={analysis.phaseSplit}
                />
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <ClassificationStats
                  moves={moves}
                  whiteName={game.white}
                  blackName={game.black}
                />
              </div>

              {analysis.keyMoments.length > 0 && (
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
                    Key moments
                  </h2>
                  <KeyMomentsList
                    items={analysis.keyMoments.map((m) => ({
                      ply: m.ply,
                      side: m.side,
                      san: m.san,
                      classification: m.classification,
                      cp_loss: m.cp_loss,
                      win_pct_delta: m.win_pct_delta,
                      best_san: m.best_san,
                    }))}
                    current={ply}
                    onSelect={setPly}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm">
              <p className="text-slate-300">This game has not been analysed yet.</p>
              <p className="text-slate-500">
                Open the Review tab and press <span className="font-medium">Analyse</span> — the review
                runs on this device and takes a minute for a full game.
              </p>
              <Link to="/review" className="inline-block rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20">
                Go to Review
              </Link>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
