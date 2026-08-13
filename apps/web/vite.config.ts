import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// apps/web Vite config (M003 T1 proof). Preview stays on Vite's default port
// 4173 — apps/web/playwright.config.ts (T6) targets the same default, so no
// explicit port is set here.
export default defineConfig({
  plugins: [react()],
});
