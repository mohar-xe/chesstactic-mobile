import { useCallback, useEffect, useState } from 'react';
import { Chess } from 'chess.js';
import type { Key } from 'chessground/types';
import ChessBoard from '../components/ChessBoard';
import Spinner from '../components/Spinner';
import { allDrills, drillStats, nextDrill, recordAttempt, type Drill } from '../analysis/drills';
import { sanOf } from '../analysis/drills';

export default function Train() {
  const [drill, setDrill] = useState<Drill | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, solved: 0, due: 0 });
  const [step, setStep] = useState(0);
  const [fen, setFen] = useState('');
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>();
  const [feedback, setFeedback] = useState<{ kind: 'good' | 'bad'; text: string } | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const next = await nextDrill();
    const all = await allDrills();
    setStats(drillStats(all));
    setDrill(next);
    setStep(0);
    setFen(next?.fen ?? '');
    setLastMove(undefined);
    setFeedback(null);
    setDone(false);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onMove = useCallback((uci: string) => {
    if (!drill) return;
    const expected = drill.line[step];
    if (!expected) return;

    const fenBefore = fen;
    const chess = new Chess(fenBefore);
    let played;
    try {
      played = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.slice(4) || undefined,
      });
    } catch {
      played = null;
    }
    if (!played) return;

    if (uci === expected) {
      setFen(chess.fen());
      setLastMove([played.from as Key, played.to as Key]);
      setFeedback({ kind: 'good', text: 'Correct.' });

      // The opponent's reply is played for you.
      const reply = drill.line[step + 1];
      if (reply) {
        const after = new Chess(chess.fen());
        try {
          after.move({
            from: reply.slice(0, 2),
            to: reply.slice(2, 4),
            promotion: reply.slice(4) || undefined,
          });
          setTimeout(() => {
            setFen(after.fen());
            setLastMove([reply.slice(0, 2) as Key, reply.slice(2, 4) as Key]);
          }, 350);
        } catch {
          /* ignore a malformed reply */
        }
      }

      const nextStep = step + 2;
      if (nextStep >= drill.line.length) {
        setTimeout(() => {
          void recordAttempt(drill, uci, true);
          setDone(true);
          setFeedback({ kind: 'good', text: 'Puzzle solved.' });
        }, 400);
      } else {
        setTimeout(() => setStep(nextStep), 400);
      }
      return;
    }

    // Wrong move: say what was expected and put the position back.
    setFen(fenBefore);
    setLastMove(undefined);
    setFeedback({
      kind: 'bad',
      text: `Not quite — the move here was ${sanOf(fenBefore, expected) ?? expected}.`,
    });
    void recordAttempt(drill, uci, false);
  }, [drill, step, fen]);

  if (loading) return <Spinner label="Building your queue…" />;

  if (!drill) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Train</h1>
        <p className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-slate-400">
          No drills yet. Analyse a game first — every mistake in it becomes a puzzle here.
        </p>
        <div className="flex gap-3 text-sm text-slate-400">
          <span>{stats.total} puzzles</span>
          <span>{stats.solved} solved</span>
          <span>{stats.due} due</span>
        </div>
      </div>
    );
  }

  const sideToMove = drill.sideToMove;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-3">
        <header>
          <h1 className="text-xl font-semibold">Train</h1>
          <p className="text-sm text-slate-400">
            A position from one of your own games. Find the move you should have played.
          </p>
        </header>

        <div className="rounded-xl bg-[#312e2b] p-2">
          <ChessBoard
            fen={fen}
            orientation={sideToMove}
            movable={!done}
            turnColor={sideToMove}
            onMove={onMove}
            lastMove={lastMove}
          />
        </div>

        {feedback && (
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              feedback.kind === 'good'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
            }`}
          >
            {feedback.text}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
            onClick={() => void load()}
          >
            {done ? 'Next puzzle' : 'Skip'}
          </button>
          <span className="self-center text-xs text-slate-500">
            {stats.total} puzzles · {stats.solved} solved · {stats.due} due
          </span>
        </div>
      </div>

      <aside className="space-y-3">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm">
          <div className="text-slate-400">From your game</div>
          <div className="mt-1">{drill.playedSan}</div>
          <div className="mt-2 text-slate-400">You played</div>
          <div className="font-medium text-amber-300">{drill.playedSan}</div>
          <div className="mt-2 text-slate-400">Best was</div>
          <div className="font-medium text-emerald-300">{drill.bestSan ?? '—'}</div>
          <div className="mt-2 text-xs text-slate-500">
            {drill.classification} · −{drill.centipawnLoss}cp
          </div>
        </div>
      </aside>
    </div>
  );
}
