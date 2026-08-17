import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// apps/web Vite config (M003 T1 proof). Preview stays on Vite's default port
// 4173 — apps/web/playwright.config.ts (T6) targets the same default, so no
// explicit port is set here.
//
// M003 T4: PWA wiring (R011 — installable offline PWA).
// - workbox 5MB cap: the worker chunk bundles @citesync/core (fflate +
//   fast-xml-parser + 9 rules) and can exceed workbox's default 2MB
//   maximumFileSizeToCacheInBytes — the exact risk M003 research flagged.
//   The worker chunk is a JS asset, so the default globPatterns precache it.
// - Icons are committed outputs of scripts/gen-pwa-icons.mjs (deterministic
//   PNG, zero-dep) and must match theme_color #1a5cff.
//
// M005-S02-T1 (Tailwind v4 — user directive): the @tailwindcss/vite plugin
// compiles `@import "tailwindcss"` in src/app.css into utilities + the
// @theme token map. Fonts (Fraunces / Be Vietnam Pro / JetBrains Mono) come
// from @fontsource as local woff2 — offline-first safe (PRD §11 — no font
// CDN). workbox globPatterns now includes woff2 so the PWA precaches the
// font files too.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'CiteSync',
        short_name: 'CiteSync',
        display: 'standalone',
        start_url: '/',
        theme_color: '#1a5cff',
        background_color: '#ffffff',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 5_000_000,
      },
      devOptions: { enabled: true },
    }),
  ],
});
