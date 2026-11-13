import { useCallback, useEffect, useState } from 'react';
import {
  MODEL_CATALOG, deleteModel, downloadModel, isModelInstalled, modelDescriptor,
} from '../engine/models';
import type { EngineTierId } from '../chess/types';
import { useProfile } from '../storage/profile';
import Spinner from '../components/Spinner';

export default function Models() {
  const profile = useProfile((s) => s.profile);
  const updateProfile = useProfile((s) => s.update);
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const map: Record<string, boolean> = {};
    for (const model of MODEL_CATALOG) {
      map[model.id] = await isModelInstalled(model.id);
    }
    setInstalled(map);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function install(id: EngineTierId) {
    setBusy(id);
    setError(null);
    try {
      await downloadModel(id, (p) => setProgress((prev) => ({ ...prev, [id]: p.ratio })));
      setProgress((prev) => ({ ...prev, [id]: 1 }));
      await refresh();
      const list = new Set(profile.installedModels);
      list.add(id);
      await updateProfile({ installedModels: [...list] });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: EngineTierId) {
    setBusy(id);
    try {
      await deleteModel(id);
      await refresh();
      await updateProfile({ installedModels: profile.installedModels.filter((m) => m !== id) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Models</h1>
        <p className="mt-1 text-sm text-slate-400">
          Patzer plays against Maia-3, a neural network that plays like a human of a given strength.
          Pick the size that fits your phone — bigger models are more accurate but heavier.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {MODEL_CATALOG.map((model) => {
          const ready = installed[model.id];
          const active = profile.engineTier === model.id;
          const ratio = progress[model.id] ?? 0;
          return (
            <article
              key={model.id}
              className={`rounded-xl border p-4 ${
                active ? 'border-[#ffc934]/60 bg-[#ffc934]/5' : 'border-white/10 bg-white/[0.02]'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-medium">
                    {model.label}
                    {active && <span className="ml-2 rounded bg-[#ffc934]/20 px-1.5 py-0.5 text-xs text-[#ffc934]">in use</span>}
                  </h2>
                  <p className="text-xs text-slate-400">
                    {model.params} · ~{model.sizeMb} MB · Elo {model.eloRange}
                  </p>
                  <p className="mt-2 max-w-prose text-sm text-slate-300">{model.blurb}</p>
                </div>
                <div className="flex gap-2">
                  {ready ? (
                    <>
                      <button
                        type="button"
                        className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
                        onClick={() => void remove(model.id)}
                        disabled={busy === model.id}
                      >
                        Remove
                      </button>
                      <button
                        type="button"
                        className="rounded-lg bg-[#ffc934] px-3 py-1.5 text-sm font-medium text-black disabled:opacity-50"
                        onClick={() => void updateProfile({ engineTier: model.id })}
                        disabled={active}
                      >
                        {active ? 'Selected' : 'Use this'}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="rounded-lg bg-[#ffc934] px-3 py-1.5 text-sm font-medium text-black disabled:opacity-50"
                      onClick={() => void install(model.id)}
                      disabled={busy === model.id}
                    >
                      {busy === model.id ? `${Math.round(ratio * 100)}%` : `Download (${model.sizeMb} MB)`}
                    </button>
                  )}
                </div>
              </div>
              {busy === model.id && ratio > 0 && ratio < 1 && (
                <div className="mt-3 h-1.5 overflow-hidden rounded bg-white/10">
                  <div className="h-full bg-[#ffc934]" style={{ width: `${Math.round(ratio * 100)}%` }} />
                </div>
              )}
            </article>
          );
        })}
      </div>

      <p className="text-xs text-slate-500">
        Models are downloaded once and stored on this device. The current default is{' '}
        {modelDescriptor(profile.engineTier).label}.
      </p>

      {busy && <Spinner label="Working…" inline />}
    </div>
  );
}
