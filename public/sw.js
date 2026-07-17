// Coin Cellar service worker — makes the game installable and lets it launch
// offline once its assets have been visited. Runtime cache only (no build-time
// precache list), so it survives Vite's hashed filenames without a manifest.
const CACHE = "coin-cellar-v2";

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

// Navigations (the HTML shell) are network-first so a fresh deploy is picked up
// immediately — the shell references content-hashed bundles, and serving a stale
// shell would pin the app to an old build. Everything else (the hashed assets
// themselves) uses stale-while-revalidate: instant from cache, refreshed in the
// background. Both fall back gracefully when offline.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    e.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const res = await fetch(req);
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        } catch {
          return (
            (await cache.match(req)) ||
            (await cache.match("./index.html")) ||
            (await cache.match("index.html")) ||
            Response.error()
          );
        }
      })()
    );
    return;
  }

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
      return Response.error();
    })()
  );
});
