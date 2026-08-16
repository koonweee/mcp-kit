import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      enabled: false,
      provider: 'v8',
    },
    include: ['test/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
