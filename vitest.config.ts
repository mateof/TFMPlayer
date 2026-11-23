import { defineConfig } from 'vitest/config';
import path from 'path';

// Kept apart from vite.config.ts so tests don't load the PWA plugin
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  define: {
    'import.meta.env.APP_VERSION': JSON.stringify('test'),
    'import.meta.env.BUILD_TIMESTAMP': JSON.stringify('test')
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    restoreMocks: true
  }
});
