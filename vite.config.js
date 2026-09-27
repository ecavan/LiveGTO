import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'LiveGTO',
        short_name: 'LiveGTO',
        description: 'Poker GTO trainer for live low-stakes',
        start_url: '/',
        display: 'standalone',
        background_color: '#0a0a0f',
        theme_color: '#0a0a0f',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,json,svg,png}'],
        // The puzzle library (~30 MB of JSON) isn't precached at install; each file is cached the
        // first time it's used, so puzzles you've seen work offline.
        globIgnores: ['library/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/library/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'puzzle-library', expiration: { maxEntries: 100 } },
          },
          {
            urlPattern: /^https:\/\/cdn\.tailwindcss\.com/,
            handler: 'CacheFirst',
            options: { cacheName: 'tailwind-cdn' },
          },
        ],
      },
    }),
  ],
});
