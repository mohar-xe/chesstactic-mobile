import { useCallback, useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import type { Key } from 'chessground/types';
import ChessBoard from '../components/ChessBoard';
import {
  dueMisses, familyOf, listMisses, queueSummary, recordClean, recordMiss,
  trainerLines, type TrainerLine,
} from '../analysis/openingTrainer';
import type { Color, OpeningMissRecord } from '../chess/types';

export default function Openings() {
  const lines = useMemo(() => trainerLines(), []);
  const [line, setLine] = useState<TrainerLine | null>(null);
  const [color, setColor] = useState<Color>('white');
  const [ply, setPly] = useState(0);
  const [fen, setFen] = useState('');
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>();
  const [feedback, setFeedback] = useState<{ kind: 'good' | 'bad'; text: string } | null>(null);
  const [misses, setMisses] = useState<OpeningMissRecord[]>([]);
  const [due, setDue] = useState<OpeningMissRecord[]>([]);
  const [summary, setSummary] = useState({ due: 0, learning: 0, learned: 0 });
  const [family, setFamily] = useState<string>('All');

  const refresh = useCallback(async () => {
    setMisses(await listMisses());
    setDue(await dueMisses());
    setSummary(await queueSummary());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const families = useMemo(() => {
    const set = new Set(lines.map(familyOf));
    return ['All', ...[...set].sort()];
  }, [lines]);

  const visible = useMemo(
    () => (family === 'All' ? lines : lines.filter((l) => familyOf(l) === family)),
    [lines, family],
  );

  function start(selected: TrainerLine, side: Color) {
    setLine(selected);
    setColor(side);
    setPly(0);
    setFen(new Chess().fen());
    setLastMove(undefined);
    setFeedback(null);
  }

  async function onMove(uci: string) {
    if (!line) return;
    const expected = line.moves[ply];
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

    if (uci !== expected.uci) {
      setFen(fenBefore);
      setLastMove(undefined);
      setFeedback({
        kind: 'bad',
        text: `That is ${played.san}. The line continues with ${expected.san}.`,
      });
      await recordMiss(line, ply, color);
      await refresh();
      return;
    }

    setFen(chess.fen());
    setLastMove([played.from as Key, played.to as Key]);
    setFeedback({ kind: 'good', text: `${played.san} — correct.` });
    await recordClean(line, ply, color);

    const reply = line.moves[ply + 1];
    if (reply) {
      const after = new Chess(chess.fen());
      try {
        after.move({
          from: reply.uci.slice(0, 2),
          to: reply.uci.slice(2, 4),
          promotion: reply.uci.slice(4) || undefined,
        });
        setTimeout(() => {
          setFen(after.fen());
          setLastMove([reply.uci.slice(0, 2) as Key, reply.uci.slice(2, 4) as Key]);
          setPly(ply + 2);
        }, 400);
      } catch {
        setPly(ply + 1);
      }
      return;
    }

    setTimeout(() => {
      setPly(ply + 1);
      setFeedback({ kind: 'good', text: 'Line complete.' });
    }, 400);
  }

  /* ------------------------------------------------------------ render -- */

  if (line) {
    const progress = line.moves.slice(0, Math.min(ply, line.moves.length)).map((m) => m.san).join(' ');
    const yourTurn = line.moves[ply]?.color === color;

    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <header className="flex items-baseline justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold">{line.name}</h1>
              <p className="text-sm text-slate-400">{line.eco} · you play {color}</p>
            </div>
            <button
              type="button"
              className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
              onClick={() => setLine(null)}
            >
              Change line
            </button>
          </header>

          <div className="rounded-xl bg-[#312e2b] p-2">
            <ChessBoard
              fen={fen}
              orientation={color}
              movable={yourTurn}
              turnColor={yourTurn ? color : color === 'white' ? 'black' : 'white'}
              onMove={(uci) => void onMove(uci)}
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

          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm">
            <div className="text-slate-400">Line so far</div>
            <div className="mt-1 font-mono text-xs leading-relaxed">{progress || '—'}</div>
          </div>
        </div>

        <aside className="space-y-3">
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm">
            <div className="text-slate-400">Your queue</div>
            <div className="mt-1">{summary.due} due · {summary.learning} to learn</div>
          </div>
        </aside>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Opening trainer</h1>
        <p className="mt-1 text-sm text-slate-400">
          Play the openings you keep getting wrong. The trainer plays your opponent's side of the
          line; a move you get wrong comes back tomorrow.
        </p>
      </header>

      <section className="flex flex-wrap items-center gap-2">
        <div className="flex gap-2">
          {(['white', 'black'] as Color[]).map((side) => (
            <button
              key={side}
              type="button"
              onClick={() => setColor(side)}
              className={`rounded-lg border px-3 py-1.5 text-sm capitalize ${
                color === side ? 'border-[#ffc934] bg-[#ffc934]/15' : 'border-white/15'
              }`}
            >
              {side}
            </button>
          ))}
        </div>
        <select
          className="rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm"
          value={family}
          onChange={(e) => setFamily(e.target.value)}
        >
          {families.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </section>

      {summary.learning > 0 && (
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <div className="font-medium">
            {summary.due} opening {summary.due === 1 ? 'miss' : 'misses'} to review
          </div>
          <ul className="mt-2 space-y-1 text-xs text-slate-400">
            {due.slice(0, 5).map((miss) => (
              <li key={miss.id}>
                {miss.lineName} — expected {miss.expectedSan} ({miss.misses}×
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-2 sm:grid-cols-2">
        {visible.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => start(item, color)}
            className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-left transition hover:border-[#ffc934]/50 hover:bg-white/[0.05]"
          >
            <div className="text-sm font-medium">{item.name}</div>
            <div className="text-xs text-slate-500">{item.eco} · {item.moves.length} plies</div>
          </button>
        ))}
      </section>
    </div>
  );
}
