import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  server: { port: 5173, host: '127.0.0.1' },
  build: {
    rolldownOptions: {
      input: {
        campaign: fileURLToPath(new URL('./index.html', import.meta.url)),
        tideglass: fileURLToPath(new URL('./tideglass/index.html', import.meta.url)),
      },
    },
    target: 'es2020',
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
    assetsInlineLimit: 0,
  },
});
