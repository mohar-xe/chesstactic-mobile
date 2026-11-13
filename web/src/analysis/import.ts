// Importing games from Chess.com and Lichess.
//
// On the phone the requests go through CapacitorHttp (the native HTTP stack),
// which is not subject to the browser's CORS rules. In a desktop browser the
// same code path falls back to `fetch`, which works for Lichess and needs a
// CORS proxy for Chess.com.
//
// Nothing is uploaded: the PGNs are parsed and stored in the local database.

import { Chess } from 'chess.js';
import { classifyTimeControl } from '../chess/timeClass';
import type { Color, GameRecord, GameSource, TimeClass } from '../chess/types';

interface CapacitorHttpCap {
  get(options: {
    url: string;
    headers?: Record<string, string>;
    responseType?: 'text' | 'json';
  }): Promise<{ data: unknown; status: number }>;
}

function nativeHttp(): CapacitorHttpCap | null {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  const plugin = cap.Plugins?.CapacitorHttp as CapacitorHttpCap | undefined;
  return plugin ?? null;
}

export async function httpGet(url: string, responseType: 'text' | 'json' = 'text'): Promise<unknown> {
  const native = nativeHttp();
  if (native) {
    const res = await native.get({ url, headers: { Accept: responseType === 'json' ? 'application/json' : 'text/plain' }, responseType });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return res.data;
  }
  const res = await fetch(url, { headers: { Accept: responseType === 'json' ? 'application/json' : 'text/plain' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return responseType === 'json' ? res.json() : res.text();
}

/* --------------------------------------------------------------- headers */

export interface ParsedGame {
  pgn: string;
  result: string;
  white: string;
  black: string;
  timeControl: string;
  timeClass: TimeClass;
  userColor: Color;
  date: string;
  endedAt: number;
  eco: string | null;
  opening: string | null;
}

const USER_AGENT = 'Patzer/8.0 (on-device chess trainer)';

function headerOf(pgn: string, name: string): string | null {
  const m = new RegExp(`^\\[${name}\\s+"([^"]*)"\\]`, 'm').exec(pgn);
  return m?.[1] ?? null;
}

/** Split a multi-game PGN text into single games. */
export function splitPgns(text: string): string[] {
  const games: string[] = [];
  const chunks = text.split(/\n(?=\s*\[Event\s)/g);
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (trimmed) games.push(trimmed);
  }
  return games.length ? games : text.trim() ? [text.trim()] : [];
}

/** Read the metadata of a single PGN. */
export function parsePgn(pgn: string, username?: string): ParsedGame {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn, { strict: false });
  } catch {
    /* fall through with whatever was parsed */
  }
  const headers = chess.getHeaders() as Record<string, string>;
  const white = headers.White ?? 'White';
  const black = headers.Black ?? 'Black';
  const result = headers.Result ?? '*';
  const tc = headers.TimeControl ?? headers.UTC ?? '300+0';
  const timeClass = classifyTimeControl(tc) ?? 'blitz';

  let userColor: Color = 'white';
  if (username) {
    const lower = username.toLowerCase();
    if (white.toLowerCase() === lower) userColor = 'white';
    else if (black.toLowerCase() === lower) userColor = 'black';
    else userColor = white.toLowerCase() === 'white' ? 'white' : 'black';
  }

  const dateStr = headers.Date ?? '';
  const endedAt = dateStr ? Date.parse(dateStr) : Date.now();

  return {
    pgn,
    result,
    white,
    black,
    timeControl: tc,
    timeClass,
    userColor,
    date: dateStr,
    endedAt: Number.isFinite(endedAt) ? endedAt : Date.now(),
    eco: headers.ECO ?? null,
    opening: headers.Opening ?? null,
  };
}

/* ------------------------------------------------------------- chess.com */

interface ChesscomGame {
  url?: string;
  pgn: string;
  time_control?: string;
  end_time?: number;
  white?: { rating?: number; username?: string };
  black?: { rating?: number; username?: string };
  time_class?: string;
}

const ARCHIVE_MONTHS = 12;

export async function fetchChesscomGames(username: string): Promise<string[]> {
  const archives = (await httpGet(`https://api.chess.com/pub/archives/${username}`, 'json')) as { archives?: { url: string }[] };
  const list = archives.archives ?? [];
  const recent = list.slice(-ARCHIVE_MONTHS);

  const pgns: string[] = [];
  for (const archive of recent) {
    try {
      const games = (await httpGet(archive.url, 'json')) as { games?: ChesscomGame[] };
      for (const game of games.games ?? []) {
        if (game.pgn) pgns.push(game.pgn);
      }
    } catch {
      /* one missing archive must not kill the import */
    }
  }
  return pgns;
}

/* --------------------------------------------------------------- lichess */

interface LichessGame {
  pgn: string;
  status?: string;
  speed?: string;
  rated?: boolean;
  createdAt?: number;
  opponents?: { rating?: number; username?: string }[];
  myColor?: string;
}

export async function fetchLichessGames(username: string, max = 50): Promise<string[]> {
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(username)}?max=${max}&clocks=true&evals=false&opening=true`;
  const text = await httpGet(url, 'text');
  const lines = String(text).split('\n').filter((l) => l.trim().length > 0);
  const pgns: string[] = [];
  for (const line of lines) {
    try {
      const game = JSON.parse(line) as LichessGame;
      if (game.pgn) pgns.push(game.pgn);
    } catch {
      /* skip malformed lines */
    }
  }
  return pgns;
}

/* ------------------------------------------------------------- importing */

export interface ImportOptions {
  username?: string;
  source?: GameSource;
  /** Skip games older than this many days. */
  maxAgeDays?: number;
}

export function toGameRecord(pgn: string, options: ImportOptions = {}): GameRecord {
  const parsed = parsePgn(pgn, options.username);
  const chess = new Chess();
  try {
    chess.loadPgn(pgn, { strict: false });
  } catch {
    /* keep going with an empty move list */
  }
  const id = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    source: options.source ?? 'imported',
    pgn,
    fen: chess.fen(),
    moves: chess.history(),
    result: parsed.result,
    white: parsed.white,
    black: parsed.black,
    userColor: parsed.userColor,
    timeControl: parsed.timeControl,
    timeClass: parsed.timeClass,
    endedAt: parsed.endedAt,
    eco: parsed.eco,
    openingName: parsed.opening,
  };
}

/** Parse a blob of PGN text into game records. */
export function importPgnText(text: string, options: ImportOptions = {}): GameRecord[] {
  const cutoff = options.maxAgeDays
    ? Date.now() - options.maxAgeDays * 86_400_000
    : null;
  const records: GameRecord[] = [];
  for (const pgn of splitPgns(text)) {
    const record = toGameRecord(pgn, options);
    if (cutoff && record.endedAt < cutoff) continue;
    records.push(record);
  }
  return records;
}

/** Import the last games of a Chess.com or Lichess account. */
export async function importFromSite(
  site: 'chesscom' | 'lichess',
  username: string,
  options: ImportOptions = {},
): Promise<GameRecord[]> {
  const pgns = site === 'chesscom'
    ? await fetchChesscomGames(username)
    : await fetchLichessGames(username);
  return importPgnText(pgns.join('\n\n'), { ...options, username, source: 'imported' });
}
