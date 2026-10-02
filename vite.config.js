import { defineConfig } from 'vite';

// Relative asset paths work both on timo-t-q.github.io/moduglazz/ and on the custom domain root
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 900 },
});
