import { useEffect, useState } from 'react';
import { playerMemory, weakestPhase, type PlayerMemory } from '../analysis/memory';
import { allRatings, formatRating } from '../game/rating';
import { listGames } from '../storage/db';
import type { RatingRecord } from '../chess/types';

const MISTAKE_LABELS: Record<string, string> = {
  allowed_mate: 'Allowed a mate',
  hung_piece: 'Hung a piece',
  missed_mate: 'Missed a mate',
  missed_win: 'Missed a win',
  missed_tactic: 'Missed a tactic',
};

const PHASE_LABELS: Record<string, string> = {
  opening: 'Opening',
  middlegame: 'Middlegame',
  endgame: 'Endgame',
};

export default function Insights() {
  const [memory, setMemory] = useState<PlayerMemory | null>(null);
  const [ratings, setRatings] = useState<RatingRecord[]>([]);
  const [games, setGames] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [mem, rat, list] = await Promise.all([playerMemory(), allRatings(), listGames(500)]);
      if (!alive) return;
      setMemory(mem);
      setRatings(rat);
      setGames(list.length);
    })();
    return () => { alive = false; };
  }, []);

  const weak = memory ? weakestPhase(memory) : null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Insights</h1>
        <p className="mt-1 text-sm text-slate-400">
          What keeps going wrong, and where. Everything here is computed from the games on this
          device.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Games stored" value={String(games)} />
        <Stat label="Games reviewed" value={String(memory?.gamesReviewed ?? 0)} />
        <Stat label="Great moves found" value={String(memory?.greatFinds ?? 0)} />
        <Stat
          label="Blitz rating"
          value={formatRating(ratings.find((r) => r.timeClass === 'blitz') ?? ratings[0]!)}
        />
      </section>

      {!memory || memory.gamesReviewed === 0 ? (
        <p className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-slate-400">
          Analyse a few games and your patterns will show up here.
        </p>
      ) : (
        <>
          {weak && (
            <section className="rounded-xl border border-[#ffc934]/40 bg-[#ffc934]/5 p-4">
              <h2 className="text-sm font-semibold">Your weakest phase</h2>
              <p className="mt-1 text-sm text-slate-300">
                {PHASE_LABELS[weak.weak]} accuracy is {weak.weakAcc}% against {weak.bestAcc}% in the{' '}
                {PHASE_LABELS[weak.best].toLowerCase()}. Focus your drills there.
              </p>
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              Accuracy by phase
            </h2>
            <div className="space-y-2">
              {(['opening', 'middlegame', 'endgame'] as const).map((phase) => {
                const value = memory.phaseAccuracy[phase];
                if (value === undefined) return null;
                return (
                  <div key={phase} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-sm text-slate-300">{PHASE_LABELS[phase]}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded bg-white/10">
                      <div
                        className="h-full rounded bg-[#ffc934]"
                        style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
                      />
                    </div>
                    <span className="w-12 shrink-0 text-right text-sm tabular-nums">{value}%</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              Recurring mistakes
            </h2>
            <ul className="divide-y divide-white/10 rounded-xl border border-white/10">
              {Object.entries(memory.mistakeGames).map(([kind, count]) => (
                <li key={kind} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="text-slate-300">{MISTAKE_LABELS[kind] ?? kind}</span>
                  <span className="tabular-nums text-slate-400">
                    {count} {count === 1 ? 'game' : 'games'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Ladders</h2>
        <ul className="divide-y divide-white/10 rounded-xl border border-white/10">
          {ratings.map((rating) => (
            <li key={rating.timeClass} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="capitalize text-slate-300">{rating.timeClass}</span>
              <span className="tabular-nums text-slate-400">
                {formatRating(rating)} · {rating.gamesPlayed} {rating.gamesPlayed === 1 ? 'game' : 'games'}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}
