import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/test/**/*.test.ts'],
    exclude: ['src/test/e2e/**'],
  },
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@app': path.resolve(__dirname, 'src/app'),
      '@infra': path.resolve(__dirname, 'src/infra'),
      '@plugins': path.resolve(__dirname, 'src/plugins'),
      '@ui': path.resolve(__dirname, 'src/ui'),
    },
  },
});
