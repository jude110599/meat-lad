import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` lets the production build be served from any sub-path,
// e.g. GitHub Pages at /meat-lad/starforge/.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173 },
});
