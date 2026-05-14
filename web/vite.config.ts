import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Transport Plovdiv',
        short_name: 'Plovdiv Bus',
        description: 'Градски транспорт - Пловдив',
        theme_color: '#1a73e8',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'any',
        lang: 'bg-BG',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // MapTiler tiles - cache 7 дни
            urlPattern: /^https:\/\/api\.maptiler\.com\/maps\/.*\.png/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'maptiler-tiles',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
            },
          },
          {
            // Static reference data - stops & lines. Stale-while-revalidate
            // дава instant load + background refresh. Offline → cached.
            urlPattern: ({ url }) =>
              url.pathname === '/api/stops' || url.pathname === '/api/lines',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'transport-static',
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Live trip polylines per line. Cache докато cookie-fresh,
            // на background refresh-ва.
            urlPattern: ({ url }) => /^\/api\/line\/[^/]+\/trips$/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'transport-trips',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 6 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
