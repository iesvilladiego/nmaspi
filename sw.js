// Service Worker (app de archivo ÚNICO)
// Estrategia: network-first para navegación (HTML), cache-first para el resto de
// assets estáticos, con actualización en segundo plano.
//
// IMPORTANTE: la precarga inicial solo incluye los ficheros HTML REALES del
// despliegue (NMasPi.html e index.html). Una lista antigua apuntaba a
// 'nmaspi.html' (en minúsculas), que NO existe en GitHub Pages (404): el precache
// fallaba en silencio y la PWA se quedaba sin fallback offline. Además, la
// instalación es RESILIENTE: si algún asset falla, se precachea el resto en vez
// de abortar todo.
//
// Al publicar una versión nueva de la app: sube CACHE_NAME al mismo número de
// APP_VERSION de index.html / NMasPi.html. La activación borra las cachés
// antiguas y skipWaiting()+clients.claim() ponen la versión nueva en marcha.

const CACHE_NAME = 'nmaspi-v2.40';
const APP_PAGES = [
  './NMasPi.html',
  './index.html',
];

// Instalación: precachear assets estáticos (resiliente: un asset que falte no
// aborta la instalación del SW)
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(APP_PAGES.map(a => cache.add(a))))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Error en install:', err))
  );
});

// Activación: limpiar cachés antiguas (nmaspi-* y cualquier 'planes-ies-*' previa)
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME && (k.startsWith('nmaspi-') || k.startsWith('planes-ies-'))).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: network-first para navegación, cache-first para assets
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Solo http(s) (v2.23): las extensiones del navegador inyectan peticiones con
  // otros esquemas (chrome-extension:) que atraviesan este handler; cache.put()
  // con ellas lanza "TypeError: Failed to execute 'put' on 'Cache': Request
  // scheme ... is unsupported". Se ignoran sin más.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Saltar Firebase y CDNs dinámicos
  if (url.hostname.includes('firebase') ||
      url.hostname.includes('googleapis') ||
      url.hostname.includes('gstatic') ||
      url.hostname.includes('cdnjs')) {
    return;
  }

  // Navegación (HTML): network-first, fallback a cache. Solo se cachean
  // respuestas correctas (un 404/500 del hosting no debe pisar la buena copia).
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req)
          .then(r => r || caches.match('./NMasPi.html'))
          .then(r => r || caches.match('./index.html'))
        )
    );
    return;
  }

  // Assets estáticos: cache-first con actualización en segundo plano
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) {
        // Actualizar en segundo plano
        fetch(req).then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(req).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return res;
      }).catch(() => cached);
    })
  );
});

// Mensajes del cliente
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  // Petición de versión (chip de la app en Inicio): responde con CACHE_NAME
  if (e.data && e.data.type === 'GET_VERSION' && e.source) {
    e.source.postMessage({ type: 'VERSION', version: CACHE_NAME });
  }
});
