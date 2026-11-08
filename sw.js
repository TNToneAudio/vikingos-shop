/**
 * VIKINGOS SHOP - Trabajo sin internet
 *
 * Guarda en el teléfono los archivos de la aplicación para que abra aunque
 * no haya conexión. Cuando hay internet, los actualiza en segundo plano
 * (la versión nueva se ve la siguiente vez que se abre la aplicación).
 *
 * IMPORTANTE: cada vez que cambie un archivo de la aplicación, suba también
 * este número de versión para que los teléfonos descarguen los cambios.
 */
const VERSION = 'vikingos-shop-v1.1';
const ARCHIVOS = [
  './', 'index.html', 'estilos.css', 'datos.js', 'ui.js', 'manifest.webmanifest',
  'fonts/pacifico-latin-400-normal.woff2',
  'fonts/poppins-latin-400-normal.woff2', 'fonts/poppins-latin-500-normal.woff2',
  'fonts/poppins-latin-600-normal.woff2', 'fonts/poppins-latin-700-normal.woff2',
  'img/favicon.png', 'img/logo-96.png', 'img/icon-192.png', 'img/icon-512.png', 'img/icon-maskable-512.png'
];

self.addEventListener('install', evento => {
  evento.waitUntil(
    caches.open(VERSION).then(cache => cache.addAll(ARCHIVOS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', evento => {
  evento.waitUntil(
    caches.keys()
      .then(nombres => Promise.all(nombres.filter(n => n !== VERSION).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', evento => {
  const pedido = evento.request;
  const url = new URL(pedido.url);
  // Solo se manejan los archivos de la propia aplicación. El servidor de Google no pasa por aquí.
  if (pedido.method !== 'GET' || url.origin !== self.location.origin) return;

  evento.respondWith(
    caches.open(VERSION).then(async cache => {
      const guardado = await cache.match(pedido, { ignoreSearch: true });
      const red = fetch(pedido).then(respuesta => {
        if (respuesta && respuesta.ok) cache.put(pedido, respuesta.clone());
        return respuesta;
      }).catch(() => null);
      if (guardado) { evento.waitUntil(red); return guardado; }
      const respuesta = await red;
      if (respuesta) return respuesta;
      if (pedido.mode === 'navigate') return cache.match('index.html');
      return new Response('Sin conexión', { status: 503, statusText: 'Sin conexión' });
    })
  );
});
