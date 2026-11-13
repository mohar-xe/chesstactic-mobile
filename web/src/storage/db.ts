// The device database: one IndexedDB with a store per collection.
import { openDatabase, Repo, type StoreDef } from './idb';
import type {
  AnalysisRecord, DrillRecord, GameRecord, LessonProgressRecord,
  OpeningMissRecord, RatingRecord,
} from '../chess/types';

const STORES: StoreDef[] = [
  { name: 'games', keyPath: 'id', indexes: [{ name: 'endedAt', keyPath: 'endedAt' }] },
  { name: 'analyses', keyPath: 'gameId' },
  { name: 'drills', keyPath: 'id', indexes: [{ name: 'dueOn', keyPath: 'dueOn' }] },
  { name: 'openingMisses', keyPath: 'id', indexes: [{ name: 'dueOn', keyPath: 'dueOn' }] },
  { name: 'lessonProgress', keyPath: 'lessonId' },
  { name: 'ratings', keyPath: 'timeClass' },
  { name: 'settings', keyPath: 'key' },
];

export interface SettingRow { key: string; value: unknown }

let ready: Promise<void> | null = null;

export interface Database {
  games: Repo<GameRecord>;
  analyses: Repo<AnalysisRecord>;
  drills: Repo<DrillRecord>;
  openingMisses: Repo<OpeningMissRecord>;
  lessonProgress: Repo<LessonProgressRecord>;
  ratings: Repo<RatingRecord>;
  settings: Repo<SettingRow>;
}

let db: Database | null = null;

export function initDatabase(): Promise<Database> {
  if (db) return Promise.resolve(db);
  if (!ready) {
    ready = openDatabase(STORES).then((raw) => {
      db = {
        games: new Repo<GameRecord>(raw, 'games'),
        analyses: new Repo<AnalysisRecord>(raw, 'analyses'),
        drills: new Repo<DrillRecord>(raw, 'drills'),
        openingMisses: new Repo<OpeningMissRecord>(raw, 'openingMisses'),
        lessonProgress: new Repo<LessonProgressRecord>(raw, 'lessonProgress'),
        ratings: new Repo<RatingRecord>(raw, 'ratings'),
        settings: new Repo<SettingRow>(raw, 'settings'),
      };
    });
  }
  return ready.then(() => db as Database);
}

export function database(): Database {
  if (!db) throw new Error('Database not initialised — call initDatabase() first');
  return db;
}

/* ------------------------------------------------------------------ games */

export async function listGames(limit = 100): Promise<GameRecord[]> {
  const all = await database().games.all();
  all.sort((a, b) => b.endedAt - a.endedAt);
  return all.slice(0, limit);
}

export async function saveGame(game: GameRecord): Promise<void> {
  await database().games.put(game);
}

export async function getGame(id: string): Promise<GameRecord | undefined> {
  return database().games.get(id);
}

export async function deleteGame(id: string): Promise<void> {
  await database().games.delete(id);
  await database().analyses.delete(id);
}

/* --------------------------------------------------------------- analyses */

export async function saveAnalysis(analysis: AnalysisRecord): Promise<void> {
  await database().analyses.put(analysis);
}

export async function getAnalysis(gameId: string): Promise<AnalysisRecord | undefined> {
  return database().analyses.get(gameId);
}

export async function listAnalyses(): Promise<AnalysisRecord[]> {
  const all = await database().analyses.all();
  all.sort((a, b) => b.scoredAt - a.scoredAt);
  return all;
}

/* ---------------------------------------------------------------- settings */

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await database().settings.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await database().settings.put({ key, value });
}
