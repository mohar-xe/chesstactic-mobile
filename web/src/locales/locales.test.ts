import { describe, expect, it } from 'vitest';
import en from './en.json';
import learnEn from './learn/en.json';
import { loadLearnTexts } from '../learn/content';

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === 'string') out[prefix + k] = v;
    else Object.assign(out, flatten(v, `${prefix}${k}.`));
  }
  return out;
}

// The app ships one language. These checks make sure the English bundle is
// complete and internally consistent — a missing key shows up as the raw key
// on screen, and a lost placeholder shows up as "undefined".
describe('en locale', () => {
  const flat = flatten(en as Tree);

  it('has no empty strings', () => {
    for (const [key, value] of Object.entries(flat)) {
      expect(value.trim().length, key).toBeGreaterThan(0);
    }
  });

  it('keeps every interpolation placeholder self-consistent', () => {
    for (const [key, value] of Object.entries(flat)) {
      const open = (value.match(/{{/g) ?? []).length;
      const close = (value.match(/}}/g) ?? []).length;
      expect(open, key).toBe(close);
    }
  });
});

describe('en lesson texts', () => {
  const flat = flatten(learnEn as Tree);

  it('has no empty strings', () => {
    for (const [key, value] of Object.entries(flat)) {
      expect(value.trim().length, key).toBeGreaterThan(0);
    }
  });

  it('keeps every bold mark in pairs', () => {
    for (const [key, value] of Object.entries(flat)) {
      expect((value.match(/\*\*/g) ?? []).length % 2, key).toBe(0);
    }
  });

  it('loads the namespace the lessons read from', async () => {
    await loadLearnTexts('en');
    const { default: i18n } = await import('../i18n');
    for (const [key, value] of Object.entries(flat)) {
      expect(i18n.getResource('en', 'learn', key), key).toBe(value);
    }
  });
});
