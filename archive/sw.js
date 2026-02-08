const CACHE_NAME = 'livegto-v1';
const PRECACHE = [
  '/',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/htmx.org@2.0.4/dist/htmx.min.js',
];

// Install: cache shell assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API/HTML, cache-first for CDN assets
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // CDN assets: cache-first
  if (url.hostname !== location.hostname) {
    e.respondWith(
      caches.match(e.request).then((cached) => cached || fetch(e.request).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        return res;
      }))
    );
    return;
  }

  // App routes: network-first with cache fallback
  e.respondWith(
    fetch(e.request).then((res) => {
      if (e.request.method === 'GET') {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
