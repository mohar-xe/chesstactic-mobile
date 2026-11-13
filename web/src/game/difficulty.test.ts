import { describe, expect, it } from 'vitest';
import {
  adaptiveBotElo,
  clampEloForModel,
  difficultyTier,
  playerEloFor,
  temperatureFor,
  topPFor,
} from './difficulty';

describe('difficulty', () => {
  it('returns the requested tier', () => {
    expect(difficultyTier('beginner').id).toBe('beginner');
    expect(difficultyTier('strong').botElo).toBe(2000);
  });

  it('anchors adaptive bot elo around the player while staying bounded', () => {
    const tier = difficultyTier('intermediate');
    expect(adaptiveBotElo(1200, tier)).toBeGreaterThanOrEqual(1050);
    expect(adaptiveBotElo(1200, tier)).toBeLessThanOrEqual(1550);
    expect(adaptiveBotElo(3000, tier)).toBeLessThanOrEqual(1550);
  });

  it('prefers actual player rating when available', () => {
    const tier = difficultyTier('casual');
    expect(playerEloFor(1350, tier)).toBe(1350);
    expect(playerEloFor(0, tier)).toBe(tier.playerElo);
  });

  it('clamps elo to model capability', () => {
    expect(clampEloForModel('maia3-5m', 2400)).toBe(1600);
    expect(clampEloForModel('maia3-79m', 300)).toBe(700);
  });

  it('maps tiers to sampling parameters', () => {
    expect(temperatureFor('beginner')).toBeGreaterThan(temperatureFor('strong'));
    expect(topPFor('beginner')).toBeGreaterThan(topPFor('strong'));
  });
});
