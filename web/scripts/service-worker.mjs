import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const assets = (await readdir('dist/assets')).map(file => `/assets/${file}`);
// Cache generic build assets only. Authenticated HTML and family data never enter CacheStorage.
const precache = [ '/manifest.webmanifest', '/lumi.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable.png', ...assets];
const hash = createHash('sha256');
hash.update(JSON.stringify(precache));
for (const path of precache) hash.update(await readFile(path === '/' ? 'dist/index.html' : `dist${path}`));
const name = `lumi-static-${hash.digest('hex').slice(0, 16)}`;
await writeFile('dist/sw.js', `
const CACHE = ${JSON.stringify(name)};
const ASSETS = ${JSON.stringify(precache)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('lumi-static-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => new Response('<!doctype html><html lang="it"><meta name="viewport" content="width=device-width"><title>Lumi</title><body><h1>Lumi ha bisogno della connessione</h1><p>Controlla la connessione e riapri Lumi.</p></body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })));
  } else if (ASSETS.includes(url.pathname)) {
    // These build assets have one representation, including across module/CORS requests.
    event.respondWith(caches.match(url.pathname, { ignoreVary: true }).then(cached => cached || fetch(event.request)));
  }
});
`);
