import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', '.next'],
  },
  resolve: {
    alias: {
      // fileURLToPath 而不是 URL.pathname：後者在 Windows 上會多一個前導斜線。
      '@': fileURLToPath(new URL('./src/', import.meta.url)),
    },
  },
});
