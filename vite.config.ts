import { defineConfig } from 'vite';

// Relative base so the production build also works when loaded via file:// (Electron desktop build).
export default defineConfig({
  base: './',
  build: { outDir: 'dist', target: 'es2022' },
});
