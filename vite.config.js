import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'LiveGTO',
        short_name: 'LiveGTO',
        description: 'Learn, drill and play live no-limit hold\'em',
        start_url: '/',
        display: 'standalone',
        background_color: '#07090d',
        theme_color: '#07090d',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,json,svg,png}'],
        // The puzzle library (~36 MB of JSON) isn't precached at install: each file is cached the
        // first time it's used, and Settings → "Download puzzle library" fetches them all.
        globIgnores: ['library/**'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/library/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'puzzle-library' },
          },
        ],
      },
    }),
  ],
});
