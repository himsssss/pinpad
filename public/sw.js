// Makes the website open instantly and work without a connection, and makes it installable.
// Each build's files (page, scripts, styles, fonts, the PDF and export helpers) are kept in
// a cache of their own, filled when the new version installs, so everything loads from this
// device. A new version waits until the page agrees to switch (the "Update" prompt) or every
// tab is closed, so an open page never loses the files it was built with. Only this site's
// files are cached: Google Drive and link previews always go to the network.

// Filled in by the build (vite.config.ts): this version's id and every file it made.
const BUILD = 'dev';
const ASSETS = [];

const CACHE = `pinpad-${BUILD}`;
const SHELL = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([...SHELL, ...ASSETS.map((a) => `./${a}`)])));
});

self.addEventListener('message', (event) => {
  if (event.data === 'update') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('pinpad-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // The page this version was built with, from the cache (a shared link's ?url= query
    // still opens it); from the network only before anything is cached.
    event.respondWith(
      caches.open(CACHE)
        .then((cache) => cache.match('./'))
        .then((hit) => hit || fetch(request)),
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: url.pathname.includes('/assets/') }).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok && url.pathname.includes('/assets/')) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
