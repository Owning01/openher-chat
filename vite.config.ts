import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  // OpenCode Zen/Go no emite CORS; en dev el navegador pega a `/zen/...` (mismo
  // origen) y Vite lo reenvía a opencode.ai. Solo aplica a `vite dev`.
  server: {
    proxy: {
      '/zen': {
        target: 'https://opencode.ai',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    globals: false,
    testTimeout: 15_000,
  },
});
