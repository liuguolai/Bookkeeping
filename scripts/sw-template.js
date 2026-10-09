/* Generated for a single, immutable application build. Never caches ledger data. */
const BUILD = __BUILD__;
const FILES = __FILES__;
const ROOT = self.registration.scope;
const PREFIX = 'pocket-ledger-shell:' + ROOT + ':';
const CACHE = PREFIX + BUILD;
const urls = FILES.map((path) => new URL(path, ROOT).href);
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        await cache.addAll(urls.map((url) => new Request(url, { cache: 'reload' })));
      } catch (error) {
        await caches.delete(CACHE);
        throw error;
      }
      // Updates wait for explicit consent or for every old window to close.
    })(),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Keep one older shell for a window that was opened during activation.
      const old = (await caches.keys()).filter((key) => key.startsWith(PREFIX) && key !== CACHE);
      await Promise.all(old.slice(0, -1).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});
self.addEventListener('fetch', (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (request.method !== 'GET' || !url.href.startsWith(ROOT)) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const pathname = url.href.split(/[?#]/)[0];
        const page =
          urls.includes(pathname) && pathname.endsWith('.html')
            ? pathname
            : new URL('index.html', ROOT).href;
        return (await cache.match(page)) || fetch(request);
      })(),
    );
    return;
  }
  const key = url.origin + url.pathname;
  if (!urls.includes(key) && !url.pathname.includes('/assets/')) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(key);
      if (hit) return hit;
      // Only our own retained build cache may satisfy an older hashed asset.
      for (const name of (await caches.keys()).filter((k) => k.startsWith(PREFIX))) {
        const old = await (await caches.open(name)).match(key);
        if (old) return old;
      }
      return fetch(request);
    })(),
  );
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'OFFLINE_STATUS')
    event.waitUntil(
      (async () => {
        const cache = await caches.open(CACHE);
        const complete = (await Promise.all(urls.map((url) => cache.match(url)))).every(Boolean);
        event.ports[0]?.postMessage({ ready: complete, build: BUILD });
      })(),
    );
  if (event.data?.type === 'ACTIVATE_IF_ALONE')
    event.waitUntil(
      (async () => {
        const windows = (
          await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        ).filter((client) => client.url.startsWith(ROOT));
        if (windows.some((client) => client.id !== event.source?.id)) {
          event.ports[0]?.postMessage({
            activated: false,
            reason: '请先关闭其他记账标签页或桌面窗口，再更新。',
          });
          return;
        }
        event.ports[0]?.postMessage({ activated: true });
        await self.skipWaiting();
      })(),
    );
});
