/**
 * Piana Service Worker — Offline caching for PWA
 * Cache-first strategy for static assets, network-first for API calls
 */

const CACHE_NAME = 'piana-v1.0.0';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/db.js',
  '/js/api.js',
  '/js/ui.js',
  '/js/quiz.js',
  '/js/report.js',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg'
];

/** Install: pre-cache all static assets */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('SW install cache error:', err))
  );
});

/** Activate: clean old caches */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

/** Fetch: cache-first for static, network-first for API */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip DeepSeek API calls (let them go to network)
  if (url.hostname === 'api.deepseek.com') return;

  // Skip chrome-extension and other non-http(s)
  if (!url.protocol.startsWith('http')) return;

  // For local static assets: cache-first
  if (url.hostname === self.location.hostname) {
    event.respondWith(
      caches.match(event.request)
        .then(cached => {
          if (cached) {
            // Return cached, update in background
            const fetchPromise = fetch(event.request)
              .then(response => {
                if (response.ok) {
                  caches.open(CACHE_NAME)
                    .then(cache => cache.put(event.request, response.clone()));
                }
                return response;
              })
              .catch(() => {});
            return cached;
          }

          // Not in cache, fetch from network
          return fetch(event.request)
            .then(response => {
              if (!response.ok) return response;
              const cloned = response.clone();
              caches.open(CACHE_NAME)
                .then(cache => cache.put(event.request, cloned));
              return response;
            })
            .catch(() => {
              // Offline fallback
              if (event.request.headers.get('accept')?.includes('text/html')) {
                return caches.match('/index.html');
              }
              return new Response('Offline', { status: 503 });
            });
        })
    );
  }
});
