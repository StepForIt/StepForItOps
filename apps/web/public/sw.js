/*
 * Service worker de la console.
 *
 * Il existe pour deux raisons, et pas une de plus : rendre l'app installable
 * (Chrome exige un gestionnaire `fetch`) et dire quelque chose de lisible quand
 * le réseau manque, au lieu du dinosaure du navigateur.
 *
 * Rien de métier n'est mis en cache : toutes les données viennent de l'API
 * derrière la session, et un écran servi depuis le cache montrerait l'état
 * d'hier à un utilisateur qui se croit à jour — ou à quelqu'un qui vient de se
 * déconnecter. Seuls les assets immuables du build et la page hors-ligne sont
 * gardés.
 *
 * Le nom des caches porte l'identifiant du build, passé par l'enregistrement
 * (`/sw.js?v=…`, cf. components/pwa-register.tsx) : les octets du fichier
 * changent donc à chaque déploiement, le navigateur installe un nouveau worker
 * et `activate` efface les caches des builds précédents. Avec un nom figé, un
 * utilisateur ayant installé l'app restait sur l'interface d'un ancien
 * déploiement — les icônes et la page hors-ligne ne portent aucune empreinte
 * dans leur URL, rien ne les aurait invalidées.
 *
 * Sans identifiant — un worker d'avant cette version, encore posé chez un
 * utilisateur, ou un build sans `BUILD_ID` — rien n'est mis en cache : mieux
 * vaut ne rien garder que figer un cache que plus rien ne renommera. Le
 * développement, lui, ne pose plus de worker du tout (cf. pwa-register.tsx).
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'none';
const CACHING = VERSION !== 'none';
const SHELL_CACHE = `nwm-shell-${VERSION}`;
const ASSET_CACHE = `nwm-assets-${VERSION}`;
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  const shell = CACHING
    ? caches.open(SHELL_CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' })))
    : Promise.resolve();
  event.waitUntil(shell.then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== SHELL_CACHE && key !== ASSET_CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Les assets versionnés par le build : leur URL change à chaque déploiement. */
function isImmutableAsset(url) {
  return url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // API, session, routes internes : toujours le réseau, jamais de cache.
  if (
    url.pathname.startsWith('/backend/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  if (CACHING && isImmutableAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  if (request.mode === 'navigate') {
    // `caches.match` rend `undefined` si la page hors-ligne n'a pas été mise en
    // cache (développement) : `respondWith(undefined)` casserait la navigation,
    // d'où la réponse de repli.
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(OFFLINE_URL);
        return (
          cached || new Response('Hors ligne', { status: 503, headers: { 'Content-Type': 'text/plain' } })
        );
      }),
    );
  }
});
