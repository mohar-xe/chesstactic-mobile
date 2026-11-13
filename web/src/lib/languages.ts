// The single UI language. Kept as a module so the rest of the code can still
// ask for "the user's language" without the plumbing of a detector.

export type Language = 'en';

export const LANGUAGE_CODES: Language[] = ['en'];

export const LANGUAGES: { code: Language; short: string; native: string; bcp47: string }[] = [
  { code: 'en', short: 'EN', native: 'English', bcp47: 'en-US' },
];

export function normalizeLanguage(value: unknown): Language {
  return 'en';
}

export function bcp47For(lang: Language): string {
  return LANGUAGES.find((l) => l.code === lang)?.bcp47 ?? 'en-US';
}
