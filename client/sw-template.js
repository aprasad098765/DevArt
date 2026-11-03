// DevArt service worker. The build fills in the file list and version (see vite.config.ts).
const PRECACHE = self.__PRECACHE__;
const VERSION = self.__VERSION__;
const SHELL = `devart-shell-${VERSION}`;
const DATA = 'devart-data';
const MAX_DATA_ENTRIES = 600;
const SERVER_ONLY = /^\/(api|mcp|collab)(\/|$)/;

self.addEventListener('install', (event) => {
  // The new version waits until the user accepts the update, so a page never mixes old and new files.
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('devart-shell-') && name !== SHELL) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

async function remember(request, response) {
  const cache = await caches.open(DATA);
  await cache.put(request, response);
  const keys = await cache.keys();
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_DATA_ENTRIES))) await cache.delete(old);
}

/** Prefers fresh data. A saved copy is marked so the app can say it's showing the last known state. */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) await remember(request, response.clone());
    return response;
  } catch (error) {
    const saved = await caches.match(request, { cacheName: DATA });
    if (!saved) throw error;
    const headers = new Headers(saved.headers);
    headers.set('x-devart-offline', '1');
    return new Response(saved.body, { status: saved.status, statusText: saved.statusText, headers });
  }
}

const isCacheableApi = (url) => {
  // Binary exports are too large to keep.
  if (url.pathname.endsWith('/export')) return url.searchParams.get('format') === 'svg';
  return true;
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/v1/')) {
    if (isCacheableApi(url)) event.respondWith(networkFirst(request));
    return;
  }
  if (SERVER_ONLY.test(url.pathname)) return;
  if (request.mode === 'navigate') {
    event.respondWith(caches.match('/index.html', { cacheName: SHELL }).then((r) => r ?? fetch(request)));
    return;
  }
  event.respondWith(caches.match(request, { cacheName: SHELL }).then((r) => r ?? fetch(request)));
});
