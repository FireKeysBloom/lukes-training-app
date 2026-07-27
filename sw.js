/* Service worker.
 *
 * Update strategy matters here: the old cache-first approach meant an installed
 * home-screen app kept serving whatever it had cached and never noticed a deploy.
 * Now:
 *   - app code (html/js/css) is NETWORK-FIRST — always fresh when online, falls
 *     back to cache when offline, so a deploy lands on the next open.
 *   - fonts and icons are CACHE-FIRST — they never change, no point re-fetching.
 * Bumping CACHE still wipes old entries, but it's no longer load-bearing.
 */
const VERSION = 'v7';
const CACHE = 'lta-' + VERSION;
const SHELL = [
  './', 'index.html', 'styles-optic.css', 'store.js', 'data.js', 'sync.js',
  'engine.js', 'app.js', 'manifest.webmanifest', 'fonts/fonts.css',
];
const IMMUTABLE = /\.(woff2|png|ico)$/i;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'version' && e.source) e.source.postMessage({ version: VERSION });
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;   // never touch Supabase or anything remote
  if (e.request.method !== 'GET') return;

  if (IMMUTABLE.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      }))
    );
    return;
  }

  // Network-first for app code.
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('index.html')))
  );
});
