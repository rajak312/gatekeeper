import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is used (instead of esbuild) because Nest relies on emitDecoratorMetadata.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    name: 'unit',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    restoreMocks: true,
    setupFiles: ['src/testing/silence-logs.ts'],
  },
});
