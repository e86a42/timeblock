import { defineConfig } from 'vite';

// GitHub Pages serves the site from /<repo>/; the deploy workflow sets BASE_PATH.
// Runtime assets (MediaPipe wasm, Draco decoder) are resolved through import.meta.env.BASE_URL.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
});
