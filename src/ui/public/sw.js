const CACHE = 'codex-shell-v4';
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

function putInCache(req, resp) {
  if (resp && resp.ok) {
    const cp = resp.clone();
    caches.open(CACHE).then((c) => c.put(req, cp)).catch(() => {});
  }
  return resp;
}

// App-shell: the document is served cache-first for instant cold starts, while
// a background fetch refreshes it. Hashed /assets/* are immutable and also
// cache-first. A 404 on an asset means a new deployment removed it, so we drop
// the cache and hard-navigate to fetch a fresh shell.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== location.origin) return;
  if (u.pathname.startsWith('/launch')) return; // 落地页不归 codex SW 管
  if (u.pathname.startsWith('/api/')) return; // API 一律不缓存

  if (req.mode === 'navigate') {
    e.respondWith(
      caches.match('/index.html').then((cached) => {
        const network = fetch(req)
          .then((resp) => putInCache('/index.html', resp))
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  if (u.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((resp) => {
            if (resp.status === 404) {
              // Stale shell referenced an asset removed by a new deployment:
              // drop the cache and reload clients so they pick up the new
              // shell — but cap hard reloads so a broken environment can't
              // loop forever (the user keeps their drafts either way once a
              // cached shell exists).
              const MAX_RECOVERIES = 3;
              const key = 'codexSw404Recoveries';
              const attempts = Number(sessionStorage.getItem(key) || 0);
              if (attempts < MAX_RECOVERIES) {
                try { sessionStorage.setItem(key, String(attempts + 1)); } catch (err) { /* ignore */ }
                caches
                  .delete(CACHE)
                  .then(() => self.clients.matchAll({ type: 'window' }))
                  .then((clients) => clients.forEach((client) => client.navigate(client.url)))
                  .catch(() => {});
              } else {
                self.clients.matchAll({ type: 'window' }).then((clients) =>
                  clients.forEach((client) =>
                    client.postMessage({ type: 'codex-shell-recovery-failed', attempts })
                  )
                );
              }
              return Response.error();
            }
            return putInCache(req, resp);
          })
      )
    );
    return;
  }

  e.respondWith(
    fetch(req)
      .then((resp) => putInCache(req, resp))
      .catch(() => caches.match(req).then((cached) => cached || caches.match('/index.html')))
  );
});
