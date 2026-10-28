import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Relative base so the built game works from any subfolder (e.g. ptxero.net/ooze/).
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        styleTest: resolve(import.meta.dirname, 'style-test.html'),
      },
    },
  },
});
