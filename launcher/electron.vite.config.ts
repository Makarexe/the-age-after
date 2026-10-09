import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: { externalizeDeps: true },
  },
  preload: {
    build: { externalizeDeps: true },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      minify: true,
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') },
    },
    plugins: [react()],
  },
});
