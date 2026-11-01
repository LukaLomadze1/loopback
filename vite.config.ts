import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative paths, so the build works on GitHub Pages under any repository name.
  base: './',
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 120_000,
  },
});
