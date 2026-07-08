// Coin Cellar service worker — makes the game installable and lets it launch
// offline once its assets have been visited. Runtime cache only (no build-time
// precache list), so it survives Vite's hashed filenames without a manifest.
const CACHE = "coin-cellar-v1";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      // drop stale caches from older versions
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// Stale-while-revalidate for same-origin GETs: serve from cache instantly when
// present, and refresh the cached copy in the background. Falls back to the
// network (and, for navigations, to the cached shell) when offline.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) return cached;
      const res = await network;
      if (res) return res;
      // offline & uncached navigation → fall back to the app shell
      if (req.mode === "navigate") {
        const shell = await cache.match("./index.html") || await cache.match("index.html");
        if (shell) return shell;
      }
      return Response.error();
    })()
  );
});
