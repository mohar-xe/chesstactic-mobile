import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { deleteGame, getAnalysis, listGames, saveAnalysis, saveGame } from '../storage/db';
import { importFromSite, importPgnText } from '../analysis/import';
import { reviewGameWithMaia } from '../analysis/maiaReview';
import { reviewGame } from '../analysis/review';
import { createStockfishClient } from '../engine/stockfish/client';
import { loadMaiaEngine } from '../engine/maia3/useMaia';
import { useProfile } from '../storage/profile';
import { getRating } from '../game/rating';
import Spinner from '../components/Spinner';
import type { AnalysisRecord, GameRecord } from '../chess/types';

export default function Review() {
  const profile = useProfile((s) => s.profile);
  const [games, setGames] = useState<GameRecord[]>([]);
  const [analyses, setAnalyses] = useState<Record<string, AnalysisRecord>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pgnText, setPgnText] = useState('');
  const [site, setSite] = useState<'chesscom' | 'lichess'>('chesscom');
  const [username, setUsername] = useState(profile.chesscomUsername ?? '');

  const refresh = useCallback(async () => {
    const list = await listGames(200);
    setGames(list);
    const map: Record<string, AnalysisRecord> = {};
    for (const game of list) {
      const analysis = await getAnalysis(game.id);
      if (analysis) map[game.id] = analysis;
    }
    setAnalyses(map);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function analyze(game: GameRecord) {
    setBusy(game.id);
    setError(null);
    setStatus('Starting the engine…');
    try {
      const rating = await getRating(game.timeClass);
      const maia = await loadMaiaEngine(profile.engineTier, {
        selfElo: rating.rating,
        oppoElo: rating.rating,
      });

      const stockfish = await createStockfishClient();
      let analysis: AnalysisRecord;
      if (stockfish.available) {
        setStatus('Stockfish is analysing the game…');
        analysis = await reviewGame(game, stockfish, maia, {
          depth: profile.analysisDepth,
          playerElo: rating.rating,
        });
        await stockfish.quit();
      } else {
        setStatus('Maia is reviewing the game…');
        analysis = await reviewGameWithMaia(game, maia, { playerElo: rating.rating });
      }
      await saveAnalysis(analysis);
      await refresh();
      setStatus(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus(null);
    } finally {
      setBusy(null);
    }
  }

  async function importPgn() {
    if (!pgnText.trim()) return;
    setBusy('import');
    setError(null);
    try {
      const records = importPgnText(pgnText, { username: username || undefined });
      for (const record of records) await saveGame(record);
      setPgnText('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function importOnline() {
    if (!username.trim()) return;
    setBusy('import');
    setError(null);
    setStatus(`Downloading ${username}'s games…`);
    try {
      const records = await importFromSite(site, username.trim(), { username: username.trim() });
      for (const record of records) await saveGame(record);
      await refresh();
      setStatus(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus(null);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Review</h1>
        <p className="mt-1 text-sm text-slate-400">
          Every game you play or import is stored on this device. Analysing a game turns it into
          drills (see Train) and feeds your Insights.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <section className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Import</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <div className="mb-1 text-xs text-slate-400">Site</div>
            <select
              className="rounded-lg border border-white/15 bg-black/30 px-3 py-2"
              value={site}
              onChange={(e) => setSite(e.target.value as 'chesscom' | 'lichess')}
            >
              <option value="chesscom">Chess.com</option>
              <option value="lichess">Lichess</option>
            </select>
          </label>
          <label className="flex-1 text-sm">
            <div className="mb-1 text-xs text-slate-400">Username</div>
            <input
              className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="your handle"
            />
          </label>
          <button
            type="button"
            className="rounded-lg bg-[#ffc934] px-3 py-2 text-sm font-medium text-black disabled:opacity-50"
            onClick={() => void importOnline()}
            disabled={busy === 'import' || !username.trim()}
          >
            Import
          </button>
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer text-slate-300">Paste PGN instead</summary>
          <textarea
            className="mt-2 h-32 w-full rounded-lg border border-white/15 bg-black/30 p-3 font-mono text-xs"
            value={pgnText}
            onChange={(e) => setPgnText(e.target.value)}
            placeholder="[Event ...]&#10;1. e4 e5 2. Nf3 Nc6 ..."
          />
          <button
            type="button"
            className="mt-2 rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20"
            onClick={() => void importPgn()}
            disabled={busy === 'import'}
          >
            Add games
          </button>
        </details>
      </section>

      {status && <Spinner label={status} inline />}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Games ({games.length})
        </h2>
        {games.length === 0 && (
          <p className="text-sm text-slate-500">No games yet. Play one or import some above.</p>
        )}
        <ul className="divide-y divide-white/10 rounded-xl border border-white/10">
          {games.map((game) => {
            const analysis = analyses[game.id];
            return (
              <li key={game.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Link to={`/review/${game.id}`} className="block truncate text-sm hover:underline">
                    {game.white} vs {game.black}
                  </Link>
                  <div className="text-xs text-slate-500">
                    {new Date(game.endedAt).toLocaleDateString()} · {game.timeControl} · {game.result}
                    {analysis ? ` · accuracy ${analysis.accuracyWhite}/${analysis.accuracyBlack}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20 disabled:opacity-50"
                  onClick={() => void analyze(game)}
                  disabled={busy === game.id}
                >
                  {busy === game.id ? 'Analysing…' : analysis ? 'Re-analyse' : 'Analyse'}
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-white/5 px-3 py-1.5 text-sm text-slate-400 hover:bg-red-500/20 hover:text-red-300"
                  onClick={() => void deleteGame(game.id).then(refresh)}
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
