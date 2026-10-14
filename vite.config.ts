import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  plugins: [
    {
      // Vite drops `blocking` from the entry script; put it back so the first painted frame is the built screen
      // (browsers without render-blocking scripts paint the bare desk instead: `.boot #desk` in style.css).
      name: 'render-blocking-entry',
      transformIndexHtml: {
        order: 'post',
        handler: (html) => html.replace('<script type="module" crossorigin', '<script type="module" blocking="render" crossorigin'),
      },
    },
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
