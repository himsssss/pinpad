// Lets the website open without a connection once it has been visited, and makes it
// installable. Pages come from the network when there is one (so updates show up at
// once) and from the cache otherwise; the app's hashed files never change, so they're
// served from the cache. Only this site's own files are cached: Google Drive and link
// previews always go to the network.
const CACHE = 'pinpad-v1';
const SHELL = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

/** The page plus the script and style files it loads (their names change with every build). */
async function precache() {
  const cache = await caches.open(CACHE);
  await cache.addAll(SHELL);
  const page = await (await cache.match('./')).text();
  const assets = [...page.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)].map((m) => `./${m[1]}`);
  await cache.addAll(assets);
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // The page itself: fresh when online, cached when not (a shared link's ?url= query
    // still opens the app).
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('./', copy));
          return response;
        })
        .catch(() => caches.match('./')),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
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
