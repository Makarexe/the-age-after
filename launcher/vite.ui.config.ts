// Renderer only, in a normal browser with a fake bridge: `npm run preview:ui`.
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  define: { 'import.meta.env.VITE_UI_PREVIEW': JSON.stringify('1') },
  server: { port: 5199 },
});
