const CACHE_NAME = 'vision-tr-v14';
const APP_SHELL = ['./', './index.html', './app.js?v=3.4.22', './config.js?v=3.2.0', './dashboard.html', './dashboard.js'];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => Promise.all(APP_SHELL.map(url => cache.add(url).catch(() => null)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(name => {
                    if (name !== CACHE_NAME) {
                        return caches.delete(name);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    if (url.protocol === 'chrome-extension:' || url.hostname.includes('supabase.co')) return;

    // HTML must be network-first so a deployment is never trapped behind an old
    // cached index page. The cache remains the offline fallback.
    if (event.request.mode === 'navigate') {
        event.respondWith(fetch(event.request).then(response => {
            if (response?.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
            return response;
        }).catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html'))));
        return;
    }
    const isMapTile = url.hostname === 'mt1.google.com';
    const isAppAsset = url.origin === self.location.origin;
    const isStaticRemote = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'cdn.tailwindcss.com', 'cdn.jsdelivr.net', 'unpkg.com'].includes(url.hostname);
    if (!isMapTile && !isAppAsset && !isStaticRemote) return;

    event.respondWith(
        caches.match(event.request).then(cached => {
            const fresh = fetch(event.request).then(response => {
                if (response && (response.ok || response.type === 'opaque')) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
                return response;
            }).catch(() => cached);
            return cached || fresh;
        })
    );
});
