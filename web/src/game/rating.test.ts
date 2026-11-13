import { describe, expect, it } from 'vitest';
import { blankRating, formatRating, isProvisional, ratingPoolFor } from './rating';

describe('rating helpers', () => {
  it('creates a blank rating for a pool', () => {
    const rating = blankRating('blitz');
    expect(rating.timeClass).toBe('blitz');
    expect(rating.gamesPlayed).toBe(0);
    expect(rating.lastPlayedAt).toBeNull();
  });

  it('formats provisional ratings with a question mark', () => {
    const rating = blankRating('rapid');
    expect(isProvisional(rating)).toBe(true);
    expect(formatRating(rating)).toMatch(/\?$/);
  });

  it('maps time controls to pools', () => {
    expect(ratingPoolFor('60+0')).toBeTruthy();
    expect(['bullet', 'blitz', 'rapid', 'daily']).toContain(ratingPoolFor('600+0'));
  });
});
