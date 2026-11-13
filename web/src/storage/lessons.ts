// Lesson progress, stored on the device.
//
// The server used to keep one row per lesson; now the same rows live in
// IndexedDB. A tiny zustand store keeps the Learn screens reactive.

import { create } from 'zustand';
import { database } from './db';
import type { LessonProgressRecord } from '../chess/types';

/** The shape the Learn screens use (kept close to the old server rows). */
export interface LessonProgressView {
  lesson_id: string;
  step: number;
  flawed: number;
  stars: number;
  completed_at: string | null;
  updated_at: string;
}

function toView(record: LessonProgressRecord): LessonProgressView {
  return {
    lesson_id: record.lessonId,
    step: record.step,
    flawed: record.flawed,
    stars: record.stars,
    completed_at: record.completedAt ? new Date(record.completedAt).toISOString() : null,
    updated_at: new Date(record.updatedAt).toISOString(),
  };
}

interface LessonState {
  progress: Map<string, LessonProgressView>;
  loaded: boolean;
  load: () => Promise<void>;
  save: (record: LessonProgressRecord) => Promise<void>;
}

export const useLessonProgress = create<LessonState>((set, get) => ({
  progress: new Map(),
  loaded: false,
  load: async () => {
    const rows = await database().lessonProgress.all();
    const map = new Map<string, LessonProgressView>();
    for (const row of rows) map.set(row.lessonId, toView(row));
    set({ progress: map, loaded: true });
  },
  save: async (record) => {
    await database().lessonProgress.put(record);
    const map = new Map(get().progress);
    map.set(record.lessonId, toView(record));
    set({ progress: map });
  },
}));
