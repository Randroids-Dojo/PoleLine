import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify('dev') },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
});
