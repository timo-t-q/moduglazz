import { defineConfig } from 'vite';

// GitHub Pages serves the site from /moduglazz/
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/moduglazz/' : '/',
});
