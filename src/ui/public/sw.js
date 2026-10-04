const CACHE = 'codex-shell-v3';
const SHELL = ['/', '/index.html', '/site.webmanifest', '/favicon.svg', '/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first with cache fallback: the bridge is always reachable over
// Tailscale, so fresh assets should win even when a cache entry exists.
// Hashed /assets/* are immutable and can be served cache-first safely.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== location.origin) return;
  if (u.pathname.startsWith('/launch')) return; // 落地页不归 codex SW 管
  if (u.pathname.startsWith('/api/')) return; // API 一律不缓存

  if (u.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((resp) => {
            if (resp && resp.ok) {
              const cp = resp.clone();
              caches.open(CACHE).then((c) => c.put(req, cp)).catch(() => {});
            }
            return resp;
          })
      )
    );
    return;
  }

  e.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp && resp.ok) {
          const cp = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, cp)).catch(() => {});
        }
        return resp;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('/')))
  );
});
