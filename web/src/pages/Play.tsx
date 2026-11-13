import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Key } from 'chessground/types';
import ChessBoard from '../components/ChessBoard';
import MoveList from '../components/MoveList';
import Spinner from '../components/Spinner';
import { GameSession, type GameState, type PlayedMove } from '../game/session';
import {
  DIFFICULTY_TIERS, DEFAULT_DIFFICULTY, adaptiveBotElo, clampEloForModel,
  playerEloFor, temperatureFor, topPFor, type DifficultyId,
} from '../game/difficulty';
import { isModelInstalled } from '../engine/models';
import { useMaiaEngine } from '../engine/maia3/useMaia';
import { useProfile } from '../storage/profile';
import { recordRatedGame, ratingPoolFor, getRating } from '../game/rating';
import { saveGame } from '../storage/db';
import { playSound } from '../lib/sounds';
import type { Color, EngineTierId, GameRecord } from '../chess/types';

const TIME_CONTROLS = [
  { id: '60+0', label: '1 min' },
  { id: '180+0', label: '3 min' },
  { id: '300+0', label: '5 min' },
  { id: '600+0', label: '10 min' },
  { id: '300+3', label: '5 min + 3s' },
];

type Phase = 'setup' | 'playing' | 'finished';

export default function Play() {
  const navigate = useNavigate();
  const profile = useProfile((s) => s.profile);
  const updateProfile = useProfile((s) => s.update);

  const [phase, setPhase] = useState<Phase>('setup');
  const [color, setColor] = useState<Color>('white');
  const [timeControl, setTimeControl] = useState('300+0');
  const [difficulty, setDifficulty] = useState<DifficultyId>(
    (profile.botElo ? tierForElo(profile.botElo).id : DEFAULT_DIFFICULTY),
  );
  const [rated, setRated] = useState(true);
  const [modelId, setModelId] = useState<EngineTierId>(profile.engineTier);

  const [session, setSession] = useState<GameSession | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [botThinking, setBotThinking] = useState(false);
  const [moves, setMoves] = useState<PlayedMove[]>([]);
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>();
  const [savedGameId, setSavedGameId] = useState<string | null>(null);
  const [ratingChange, setRatingChange] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelInstalled, setModelInstalled] = useState<boolean | null>(null);

  const { engine, status: engineStatus, error: engineError } = useMaiaEngine(modelId);
  const botThinkingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setModelInstalled(null);
    void isModelInstalled(modelId).then((installed) => {
      if (!cancelled) setModelInstalled(installed);
    });
    return () => { cancelled = true; };
  }, [modelId]);

  useEffect(() => {
    updateProfile({ engineTier: modelId });
  }, [modelId, updateProfile]);

  const tier = useMemo(() => DIFFICULTY_TIERS.find((t) => t.id === difficulty) ?? DIFFICULTY_TIERS[2]!, [difficulty]);

  const finish = useCallback(async (result: string) => {
    if (!session) return;
    const pgn = session.pgn();
    const record: GameRecord = {
      id: `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      source: 'played',
      pgn,
      fen: session.fen,
      moves: session.moves.map((m) => m.san),
      result,
      white: color === 'white' ? 'You' : 'Maia-3',
      black: color === 'black' ? 'You' : 'Maia-3',
      userColor: color,
      timeControl,
      timeClass: ratingPoolFor(timeControl),
      endedAt: Date.now(),
      opponentModel: modelId,
      opponentElo: session.botElo,
      rated,
    };
    await saveGame(record);
    setSavedGameId(record.id);
    setPhase('finished');

    if (rated) {
      const score = userScore(result, color);
      const update = await recordRatedGame({
        timeClass: ratingPoolFor(timeControl),
        score,
        opponentElo: session.botElo,
      });
      setRatingChange(update.delta);
    }
  }, [session, color, timeControl, modelId, rated]);

  const start = useCallback(async () => {
    if (!engine) {
      if (modelInstalled === false) {
        setError('Selected Maia model is not installed. Download it from Models first.');
      }
      return;
    }
    setError(null);
    setMoves([]);
    setSavedGameId(null);
    setRatingChange(null);
    setPhase('playing');

    const poolRating = await currentRating();
    const targetElo = clampEloForModel(
      modelId,
      profile.adaptiveBot ? adaptiveBotElo(poolRating, tier) : tier.botElo,
    );

    engine.update({
      selfElo: clampEloForModel(modelId, playerEloFor(poolRating, tier)),
      oppoElo: targetElo,
      temperature: temperatureFor(difficulty),
      topP: topPFor(difficulty),
    });

    const created = new GameSession(
      {
        timeControl,
        userColor: color,
        botElo: targetElo,
        modelId,
        temperature: temperatureFor(difficulty),
        topP: topPFor(difficulty),
      },
      engine,
      {
        onState: (next) => setState(next),
        onMove: (move) => {
          setMoves((prev) => [...prev, move]);
          setLastMove([move.uci.slice(0, 2) as Key, move.uci.slice(2, 4) as Key]);
          playSound('move');
        },
        onBotThinking: (thinking) => {
          botThinkingRef.current = thinking;
          setBotThinking(thinking);
        },
        onGameOver: (result) => void finish(result),
      },
    );
    setSession(created);
    created.start();
    if (color === 'black') void runBot(created);
  }, [engine, modelId, profile.adaptiveBot, tier, timeControl, color, difficulty]);

  const runBot = useCallback(async (target: GameSession) => {
    try {
      await target.botMove();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // The bot plays whenever it is its turn.
  useEffect(() => {
    if (phase !== 'playing' || !session) return;
    if (state?.turn !== session.botColor) return;
    if (botThinkingRef.current) return;
    void runBot(session);
  }, [phase, session, state?.turn, runBot]);

  const onUserMove = useCallback((uci: string) => {
    if (!session) return;
    const move = session.userMove(uci);
    if (!move) return;
    setState(session.state());
  }, [session]);

  /* ------------------------------------------------------------- render -- */

  if (phase === 'setup') {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <header>
          <h1 className="text-xl font-semibold">Play</h1>
          <p className="mt-1 text-sm text-slate-400">
            Maia-3 plays like a human of the chosen strength — it misses things, it does not
            calculate.
          </p>
        </header>

        {engineStatus === 'loading' && <Spinner label="Loading the model…" />}
        {engineStatus === 'error' && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {engineError ?? 'Could not load the model.'}{' '}
            <Link to="/models" className="underline">Manage models</Link>
          </div>
        )}

        <Field label="Your colour">
          <Segmented
            options={[
              { value: 'white', label: 'White' },
              { value: 'black', label: 'Black' },
            ]}
            value={color}
            onChange={(v) => setColor(v as Color)}
          />
        </Field>

        <Field label="Time control">
          <Segmented
            options={TIME_CONTROLS.map((tc) => ({ value: tc.id, label: tc.label }))}
            value={timeControl}
            onChange={setTimeControl}
          />
        </Field>

        <Field label="Opponent strength">
          <div className="grid gap-2">
            {DIFFICULTY_TIERS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setDifficulty(t.id)}
                className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                  difficulty === t.id
                    ? 'border-[#ffc934] bg-[#ffc934]/10'
                    : 'border-white/10 hover:border-white/30'
                }`}
              >
                <div className="font-medium">{t.label}</div>
                <div className="text-xs text-slate-400">{t.blurb}</div>
              </button>
            ))}
          </div>
        </Field>

        <Field label="Model">
          <select
            className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm"
            value={modelId}
            onChange={(e) => setModelId(e.target.value as EngineTierId)}
          >
            <option value="maia3-5m">Maia-3 5M (fastest)</option>
            <option value="maia3-23m">Maia-3 23M (balanced)</option>
            <option value="maia3-79m">Maia-3 79M (strongest)</option>
          </select>
        </Field>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={rated}
            onChange={(e) => setRated(e.target.checked)}
          />
          Rated — count this game towards your local rating
        </label>

        {modelInstalled === false && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            The selected model is not installed. <Link to="/models" className="underline hover:text-amber-100">Download it in Models</Link> to play against Maia.
          </div>
        )}
        {engineStatus === 'loading' && modelInstalled !== false && (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Spinner inline /> Loading Maia engine…
          </div>
        )}
        {(engineError || error) && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error ?? engineError}
          </div>
        )}
        <button
          type="button"
          onClick={() => void start()}
          disabled={!engine || modelInstalled === false || engineStatus === 'loading'}
          className="w-full rounded-xl bg-[#ffc934] px-4 py-3 font-semibold text-black disabled:opacity-50"
        >
          {engineStatus === 'loading' ? 'Loading engine…' : 'Start game'}
        </button>
      </div>
    );
  }

  const fen = state?.fen ?? session?.fen ?? '';
  const userTurn = state?.turn === color;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-slate-400">
              {botThinking ? 'Maia is thinking…' : userTurn ? 'Your move' : 'Waiting…'}
            </div>
            <div className="text-lg font-semibold">
              {phase === 'finished'
                ? `Game over — ${state?.result ?? ''}`
                : `${fmtClock(state ? (state.turn === 'white' ? state.whiteMs : state.blackMs) : undefined)}`}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
              onClick={() => session?.resign()}
              disabled={phase !== 'playing'}
            >
              Resign
            </button>
            <button
              type="button"
              className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
              onClick={() => session?.offerDraw()}
              disabled={phase !== 'playing'}
            >
              Draw
            </button>
          </div>
        </div>

        <div className="rounded-xl bg-[#312e2b] p-2">
          <ChessBoard
            fen={fen}
            orientation={color}
            movable={phase === 'playing' && userTurn}
            turnColor={state?.turn === 'white' ? 'white' : 'black'}
            onMove={onUserMove}
            lastMove={lastMove}
          />
        </div>

        {phase === 'finished' && (
          <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-sm">
              Result: <span className="font-semibold">{state?.result}</span>
              {state?.reason ? ` (${state.reason})` : ''}
            </div>
            {ratingChange !== null && (
              <div className="text-sm">
                Rating: <span className="font-semibold">{ratingChange >= 0 ? `+${ratingChange}` : ratingChange}</span>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg bg-[#ffc934] px-3 py-1.5 text-sm font-medium text-black"
                onClick={() => setPhase('setup')}
              >
                New game
              </button>
              {savedGameId && (
                <button
                  type="button"
                  className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
                  onClick={() => navigate(`/review/${savedGameId}`)}
                >
                  Review this game
                </button>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
      </div>

      <aside className="space-y-3">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <div className="mb-2 flex justify-between text-xs text-slate-400">
            <span>White</span>
            <span>{fmtClock(state?.whiteMs)}</span>
          </div>
          <div className="mb-3 flex justify-between text-xs text-slate-400">
            <span>Black</span>
            <span>{fmtClock(state?.blackMs)}</span>
          </div>
          <MoveList
            moves={moves.map((m, i) => ({ ply: i + 1, san: m.san }))}
            current={moves.length}
            onSelect={() => undefined}
          />
        </div>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-slate-300">{label}</div>
      {children}
    </div>
  );
}

function Segmented({
  options, value, onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-lg border px-3 py-1.5 text-sm transition ${
            value === option.value
              ? 'border-[#ffc934] bg-[#ffc934]/15 text-white'
              : 'border-white/15 text-slate-300 hover:border-white/30'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function tierForElo(elo: number) {
  return DIFFICULTY_TIERS.find((t) => Math.abs(t.botElo - elo) < 200) ?? DIFFICULTY_TIERS[2]!;
}

async function currentRating(): Promise<number> {
  const rating = await getRating('blitz');
  return rating.rating;
}

function userScore(result: string, color: Color): 0 | 0.5 | 1 {
  if (result === '1/2-1/2') return 0.5;
  const won = color === 'white' ? result === '1-0' : result === '0-1';
  return won ? 1 : 0;
}

function fmtClock(ms: number | undefined): string {
  if (ms === undefined) return '—';
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
