/*
 * OpenHer Chat — service worker mínimo.
 * Red primero con respaldo en caché para todo lo same-origin (navegación y
 * assets); el corpus legal y el proxy de OpenCode van siempre a red.
 * Solo se registra en web de producción (fuera de Capacitor).
 *
 * Por qué red primero: la pestaña puede quedar abierta con el shell viejo
 * mientras se publica un deploy; si el SW sirviera assets viejos desde caché,
 * los chunks con hash ya borrados rompían rutas (p. ej. Ajustes no abría).
 * Con red primero, un 404 cae a la copia en caché (mismo contenido por hash) y
 * una actualización del corpus nunca queda pegada.
 */
const CACHE_NAME = 'openher-shell-v2';
const SHELL_ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // El corpus legal (`/legal/`) evita la caché: se versiona con `?v=<hash>` y
  // debe llegar fresco. El proxy de OpenCode (`/zen/`) tampoco se cachea.
  if (url.pathname.startsWith('/legal/') || url.pathname.startsWith('/zen/')) {
    event.respondWith(fetch(request));
    return;
  }
  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request.mode === 'navigate' ? '/index.html' : request, response.clone());
      return response;
    }
    // Un asset con hash que el deploy ya no sirve (404/410) puede estar en
    // caché: el contenido es el correcto para esa URL y mantiene viva la
    // pestaña vieja hasta que la app se recargue sola.
    if (!response.ok) {
      const cached = await cache.match(request);
      if (cached !== undefined) return cached;
      return response;
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached !== undefined) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match('/index.html');
      if (shell !== undefined) return shell;
    }
    return Response.error();
  }
}
