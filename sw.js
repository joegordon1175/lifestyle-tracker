/* Service worker: the app shell works offline; the OCR engine is cached the
   first time it is fetched so later scans work without a connection. */

const VERSION = 'v5';
const SHELL = `shell-${VERSION}`;
const VENDOR = `vendor-${VERSION}`;
const INBOX = 'shared-inbox';        // holds a file handed over by the share sheet
const INBOX_KEY = './__shared-file';

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
  './js/clipboard.js',
  './js/scan.js',
  './js/pdf.js',
  './js/receipts.js',
  './js/export.js',
  './js/views/home.js',
  './js/views/records.js',
  './js/views/insights.js',
  './js/views/more.js',
  './js/views/form.js',
  './js/views/capture.js',
  './js/views/cropper.js',
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
    // INBOX is excluded: it may be holding a file a share is mid-way through
    // handing over, and it is not versioned content.
    await Promise.all(keys
      .filter(k => k !== SHELL && k !== VENDOR && k !== INBOX)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Android share sheet: the OS POSTs the shared file here. Stash it and bounce
  // into the app, which picks it up on boot — a POST cannot render the page.
  if (request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith((async () => {
      try {
        const form = await request.formData();
        const file = form.get('file');
        if (file && file.size) {
          const cache = await caches.open(INBOX);
          await cache.put(INBOX_KEY, new Response(file, {
            headers: {
              'content-type': file.type || 'application/octet-stream',
              'x-filename': encodeURIComponent(file.name || 'shared'),
            },
          }));
        }
      } catch { /* fall through to the app either way */ }
      return Response.redirect(new URL('./?shared=1', self.location).href, 303);
    })());
    return;
  }

  if (request.method !== 'GET') return;

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
