// Compatibility barrel.
//
// The app's data model lives in `chess/types.ts`. Older modules still import
// from `../types`, so this file re-exports the canonical definitions instead
// of keeping a second copy that could drift.

export * from './chess/types';

/** The stored analysis of a game. */
export type AnalysisResult = import('./chess/types').AnalysisRecord;
