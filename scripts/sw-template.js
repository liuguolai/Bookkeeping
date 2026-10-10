/* Generated for a single, immutable application build. Never caches ledger data. */
const BUILD = __BUILD__;
const FILES = __FILES__;
const ROOT = self.registration.scope;
const PREFIX = 'pocket-ledger-shell:' + ROOT + ':';
const CACHE = PREFIX + BUILD;
const urls = FILES.map((path) => new URL(path, ROOT).href);
// Cloudflare redirects /index.html to /. A followed redirect cannot be replayed
// directly for a navigation request whose redirect mode is "manual".
function navigationResponse(response) {
  return response.redirected
    ? new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    : response;
}
async function repairNavigationCache(cache) {
  for (const request of await cache.keys()) {
    if (!request.url.startsWith(ROOT) || !new URL(request.url).pathname.endsWith('.html')) continue;
    const response = await cache.match(request);
    if (response?.ok && response.redirected) {
      // Preserve the exact HTML and headers; remove only redirect metadata.
      await cache.put(request, navigationResponse(response));
    }
  }
}
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        await cache.addAll(urls.map((url) => new Request(url, { cache: 'reload' })));
        await repairNavigationCache(cache);
      } catch (error) {
        await caches.delete(CACHE);
        throw error;
      }
      // Heal already-installed shells while this worker waits for activation.
      // This does not replace their content, reload editing windows, or touch IDB.
      for (const name of (await caches.keys()).filter(
        (key) => key.startsWith(PREFIX) && key !== CACHE,
      )) {
        try {
          await repairNavigationCache(await caches.open(name));
        } catch {
          /* Retry via the new worker after activation. */
        }
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
  // Authentication and encrypted account responses must never enter the offline shell.
  if (url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const pathname = url.href.split(/[?#]/)[0];
        const page =
          urls.includes(pathname) && pathname.endsWith('.html')
            ? pathname
            : new URL('index.html', ROOT).href;
        const cached = await cache.match(page);
        return cached ? navigationResponse(cached) : fetch(request);
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
