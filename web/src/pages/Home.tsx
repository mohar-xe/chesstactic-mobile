import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listGames } from '../storage/db';
import { allRatings, formatRating } from '../game/rating';
import { drillStats, allDrills } from '../analysis/drills';
import { queueSummary } from '../analysis/openingTrainer';
import { isModelInstalled } from '../engine/models';
import { useProfile } from '../storage/profile';
import type { GameRecord, RatingRecord } from '../chess/types';

interface HomeData {
  games: GameRecord[];
  ratings: RatingRecord[];
  drills: { total: number; solved: number; due: number };
  openings: { due: number; learning: number };
  modelReady: boolean;
}

export default function Home() {
  const profile = useProfile((s) => s.profile);
  const [data, setData] = useState<HomeData | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [games, ratings, drills, openings, modelReady] = await Promise.all([
        listGames(5),
        allRatings(),
        allDrills().then(drillStats),
        queueSummary(),
        isModelInstalled(profile.engineTier),
      ]);
      if (!alive) return;
      setData({ games, ratings, drills, openings, modelReady });
    })();
    return () => { alive = false; };
  }, [profile.engineTier]);

  const blitz = data?.ratings.find((r) => r.timeClass === 'blitz');
  const actions = [
    { to: '/play', label: 'Play a game', hint: 'Against Maia-3, a human-like opponent' },
    { to: '/train', label: 'Train', hint: 'Drills built from your own mistakes' },
    { to: '/review', label: 'Review', hint: 'Analyse a game and see where it turned' },
    { to: '/openings', label: 'Opening trainer', hint: 'Drill the openings you keep getting wrong' },
    { to: '/learn', label: 'Learn', hint: '69 lessons from basics to openings' },
  ];

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <span className="text-3xl">{profile.avatarEmoji}</span>
        <div>
          <h1 className="text-xl font-semibold">
            {profile.displayName ? `Hello, ${profile.displayName}` : 'Welcome back'}
          </h1>
          <p className="text-sm text-slate-400">
            {data?.modelReady
              ? 'Everything runs on this device — no account, no server.'
              : 'Download a Maia-3 model to start playing (Models tab).'}
          </p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Blitz rating" value={blitz ? formatRating(blitz) : '—'} />
        <Stat label="Games" value={String(data?.games.length ?? 0)} />
        <Stat label="Drills due" value={String(data?.drills.due ?? 0)} />
        <Stat label="Opening misses" value={String(data?.openings.learning ?? 0)} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        {actions.map((action) => (
          <Link
            key={action.to}
            to={action.to}
            className="rounded-xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-[#ffc934]/50 hover:bg-white/[0.06]"
          >
            <div className="font-medium">{action.label}</div>
            <div className="mt-1 text-sm text-slate-400">{action.hint}</div>
          </Link>
        ))}
      </section>

      {data && data.games.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Recent games</h2>
          <ul className="divide-y divide-white/10 rounded-xl border border-white/10">
            {data.games.map((game) => (
              <li key={game.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm">
                    {game.white} vs {game.black}
                  </div>
                  <div className="text-xs text-slate-500">
                    {new Date(game.endedAt).toLocaleDateString()} · {game.timeControl}
                    {game.openingName ? ` · ${game.openingName}` : ''}
                  </div>
                </div>
                <span className="shrink-0 rounded bg-white/10 px-2 py-1 text-xs">{game.result}</span>
              </li>
            ))}
          </ul>
          <Link to="/review" className="mt-2 inline-block text-sm text-[#ffc934] hover:underline">
            See all games →
          </Link>
        </section>
      )}
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
