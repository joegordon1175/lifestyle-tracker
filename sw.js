/* Service worker: the app shell works offline; the OCR engine is cached the
   first time it is fetched so later scans work without a connection. */

const VERSION = 'v2';
const SHELL = `shell-${VERSION}`;
const VENDOR = `vendor-${VERSION}`;

const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/util.js',
  './js/store.js',
  './js/presets.js',
  './js/extract.js',
  './js/csv.js',
  './js/views/home.js',
  './js/views/records.js',
  './js/views/insights.js',
  './js/views/more.js',
  './js/views/form.js',
  './js/views/capture.js',
  './js/views/shared.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll(SHELL_FILES.map(u => new Request(u, { cache: 'reload' })));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== SHELL && k !== VENDOR).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Tesseract / pdf.js / language data — cache-first, they are versioned URLs.
  if (url.origin !== self.location.origin) {
    if (!/jsdelivr|unpkg|tessdata/.test(url.hostname)) return;
    event.respondWith((async () => {
      const cache = await caches.open(VENDOR);
      const hit = await cache.match(request);
      if (hit) return hit;
      const res = await fetch(request);
      if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
      return res;
    })());
    return;
  }

  // Same-origin: network-first so updates land, falling back to cache offline.
  event.respondWith((async () => {
    try {
      const res = await fetch(request);
      if (res.ok) {
        const cache = await caches.open(SHELL);
        cache.put(request, res.clone());
      }
      return res;
    } catch {
      const cached = await caches.match(request) || await caches.match('./index.html');
      if (cached) return cached;
      throw new Error('offline');
    }
  })());
});
