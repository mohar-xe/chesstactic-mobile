import { useState } from 'react';
import { useProfile } from '../storage/profile';
import { setSoundEnabled } from '../lib/sounds';
import { DIFFICULTY_TIERS, DEFAULT_DIFFICULTY, type DifficultyId } from '../game/difficulty';
import { MODEL_CATALOG } from '../engine/models';
import type { EngineTierId } from '../chess/types';

const EMOJIS = ['♞', '♜', '♝', '♛', '🧙', '🦊', '🐼', '🐧', '🚀', '🌵'];

export default function Settings() {
  const profile = useProfile((s) => s.profile);
  const update = useProfile((s) => s.update);
  const [saved, setSaved] = useState(false);

  const set = (patch: Parameters<typeof update>[0]) => {
    void update(patch);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const tier = DIFFICULTY_TIERS.find((t) => t.botElo === profile.botElo);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-slate-400">
          Everything is stored on this device. There is no account and no server.
        </p>
      </header>

      <Section title="Profile">
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-slate-400">Display name</span>
          <input
            className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2"
            value={profile.displayName}
            onChange={(e) => set({ displayName: e.target.value })}
          />
        </label>
        <div>
          <span className="mb-1 block text-xs text-slate-400">Avatar</span>
          <div className="flex flex-wrap gap-2">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => set({ avatarEmoji: emoji })}
                className={`h-10 w-10 rounded-lg border text-xl ${
                  profile.avatarEmoji === emoji ? 'border-[#ffc934]' : 'border-white/10'
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Opponent">
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-slate-400">Model</span>
          <select
            className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2"
            value={profile.engineTier}
            onChange={(e) => set({ engineTier: e.target.value as EngineTierId })}
          >
            {MODEL_CATALOG.map((model) => (
              <option key={model.id} value={model.id}>{model.label}</option>
            ))}
          </select>
        </label>

        <div>
          <span className="mb-1 block text-xs text-slate-400">Strength</span>
          <div className="grid gap-2">
            {DIFFICULTY_TIERS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => set({ botElo: t.botElo, adaptiveBot: false })}
                className={`rounded-lg border px-3 py-2 text-left text-sm ${
                  tier?.id === t.id && !profile.adaptiveBot
                    ? 'border-[#ffc934] bg-[#ffc934]/10'
                    : 'border-white/10 hover:border-white/30'
                }`}
              >
                <div className="font-medium">{t.label}</div>
                <div className="text-xs text-slate-400">{t.blurb}</div>
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={profile.adaptiveBot}
            onChange={(e) => set({ adaptiveBot: e.target.checked })}
          />
          <span>
            Adaptive opponent
            <span className="block text-xs text-slate-400">
              The bot follows your local rating (around {tier?.label ?? DEFAULT_DIFFICULTY} level).
            </span>
          </span>
        </label>
      </Section>

      <Section title="Reviews">
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-slate-400">Stockfish depth</span>
          <input
            type="range"
            min={8}
            max={22}
            step={1}
            value={profile.analysisDepth}
            onChange={(e) => set({ analysisDepth: Number(e.target.value) })}
            className="w-full"
          />
          <span className="text-xs text-slate-400">
            {profile.analysisDepth} — higher is more accurate but slower. Only used on Android, where
            Stockfish ships with the app.
          </span>
        </label>
      </Section>

      <Section title="Sound & speech">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={profile.soundEnabled}
            onChange={(e) => {
              setSoundEnabled(e.target.checked);
              set({ soundEnabled: e.target.checked });
            }}
          />
          Move sounds
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={profile.ttsEnabled}
            onChange={(e) => set({ ttsEnabled: e.target.checked })}
          />
          Read lessons aloud
        </label>
        {profile.ttsEnabled && (
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-slate-400">Speech rate</span>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={profile.ttsRate}
              onChange={(e) => set({ ttsRate: Number(e.target.value) })}
              className="w-full"
            />
          </label>
        )}
      </Section>

      <Section title="Accounts">
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-slate-400">Chess.com username</span>
          <input
            className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2"
            value={profile.chesscomUsername ?? ''}
            onChange={(e) => set({ chesscomUsername: e.target.value || null })}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-slate-400">Lichess username</span>
          <input
            className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2"
            value={profile.lichessUsername ?? ''}
            onChange={(e) => set({ lichessUsername: e.target.value || null })}
          />
        </label>
        <p className="text-xs text-slate-500">
          Used only to import your games into the Review tab. The credentials are never stored.
        </p>
      </Section>

      <Section title="Appearance">
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-slate-400">Theme</span>
          <select
            className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2"
            value={profile.siteTheme}
            onChange={(e) => set({ siteTheme: e.target.value as 'auto' | 'light' | 'dark' })}
          >
            <option value="auto">Follow the system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </Section>

      {saved && <div className="text-sm text-emerald-300">Saved.</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
      {children}
    </section>
  );
}
