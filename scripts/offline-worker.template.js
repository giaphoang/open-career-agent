/* Generated service worker: cache only public static build entry assets. */
const PRECACHE = __OFFLINE_ASSETS__;
const SHELL_URL = new URL('./', self.registration.scope).href;
// CacheStorage is shared by all service workers on an origin. Include the
// deployment path so sibling GitHub Pages sites cannot evict each other.
const CACHE_PREFIX = 'open-career-shell-' + encodeURIComponent(new URL(SHELL_URL).pathname) + '-';
const CACHE_NAME = CACHE_PREFIX + '__OFFLINE_REVISION__';
const ALLOWED_URLS = PRECACHE.map(path => new URL(path, SHELL_URL).href);
const ALLOWED = new Set(ALLOWED_URLS);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME)
    .then(cache => cache.addAll(ALLOWED_URLS))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // No cross-origin requests, form posts, chat data, model files or APIs.
  if (url.origin !== self.location.origin || !url.href.startsWith(SHELL_URL)) return;
  if (request.mode === 'navigate') {
    // Network-first online; offline uses the version-consistent shell. Never
    // overwrite a cached HTML shell with markup referencing uncached assets.
    event.respondWith(fetch(request).catch(async () =>
      (await (await caches.open(CACHE_NAME)).match(SHELL_URL)) ?? Response.error()));
  } else if (ALLOWED.has(url.href)) {
    event.respondWith(caches.open(CACHE_NAME).then(cache => cache.match(request))
      .then(cached => cached ?? fetch(request)));
  }
});
