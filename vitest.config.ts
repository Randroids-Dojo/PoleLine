import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify('dev'), __EDITION__: JSON.stringify(process.env.VITE_EDITION === 'toybox' ? 'toybox' : 'web') },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
});
