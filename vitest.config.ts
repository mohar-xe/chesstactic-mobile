import { defineConfig } from 'vitest/config';

// Single-workspace runner. The app lives in web/src and its unit tests sit
// next to the modules they cover.
export default defineConfig({
  test: {
    include: ['web/src/**/*.test.{ts,tsx}'],
    // Node by default; the few component tests opt into jsdom with a
    // `// @vitest-environment happy-dom` pragma at the top of the file.
    environment: 'node',
  },
});
