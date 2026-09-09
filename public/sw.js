/*
 * Service worker de Mis Cartones.
 *
 * Existe por dos motivos, en este orden:
 *
 *   1. Sin un service worker con manejador de `fetch`, Chrome no ofrece
 *      instalar la app. Es requisito, no adorno.
 *   2. Que abrir el icono con mala señal enseñe algo en vez de la página del
 *      dinosaurio.
 *
 * LO QUE NUNCA SE GUARDA
 * ----------------------
 * Nada que empiece por `/api/`, y ninguna respuesta a una petición que no sea
 * GET. Este juego mueve dinero: un saldo, una lista de compras o un historial
 * servidos desde la caché serían cifras viejas presentadas como actuales, y
 * un jugador que ve $12 cuando tiene $4 cree que le robaron. Lo mismo con la
 * sesión: una respuesta guardada podría enseñársela al siguiente que abra el
 * teléfono. Que falle es preferible a que mienta.
 */

// Al cambiar este número se tira la caché vieja entera en la siguiente
// visita. Súbelo cuando cambie el esqueleto (offline.html, iconos).
const VERSION = 'v1';
const CACHE = `mis-cartones-${VERSION}`;

// El mínimo para que la app pinte algo estando sin red.
const ESQUELETO = ['/offline.html', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // `catch` a propósito: si uno de estos no está, la instalación no debe
      // fallar entera y dejar la app sin service worker.
      .then((c) => c.addAll(ESQUELETO))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((claves) =>
        Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Otro dominio (Supabase, el banco): pasa de largo, sin tocar.
  if (url.origin !== self.location.origin) return;
  // Dinero y sesión: SIEMPRE a la red. Ver la nota de arriba.
  if (url.pathname.startsWith('/api/')) return;

  // Navegación: primero la red, y si no hay, la pantalla de sin conexión.
  // Nunca se sirve una página guardada como si fuera la de ahora: detrás de
  // cada una hay un saldo.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match('/offline.html').then((r) => r ?? Response.error())
      )
    );
    return;
  }

  // Lo estático de Next lleva un hash en el nombre: si el nombre es el mismo,
  // el contenido es el mismo. Se puede servir de caché sin miedo, y es lo que
  // hace que la app abra rápido en un teléfono de gama baja.
  const estatico =
    url.pathname.startsWith('/_next/static/') ||
    /\.(png|jpg|jpeg|svg|webp|woff2?|mp3|ogg|glb)$/i.test(url.pathname);
  if (!estatico) return;

  event.respondWith(
    caches.match(req).then((guardada) => {
      if (guardada) return guardada;
      return fetch(req).then((res) => {
        // Las respuestas opacas o con error no se guardan: una vez dentro de
        // la caché, un 404 se sirve para siempre.
        if (res.ok && res.type === 'basic') {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
        }
        return res;
      });
    })
  );
});
