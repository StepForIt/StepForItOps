'use client';

import React from 'react';

/** Marque le rechargement déjà fait, pour ne jamais boucler. */
const RELOADED_KEY = 'nwm.sw-cleaned';

/**
 * Retire le service worker et ses caches. Ne touche qu'aux caches de la console
 * (`nwm-`) : le navigateur en héberge d'autres, qui ne nous appartiennent pas.
 */
async function unregisterServiceWorker(): Promise<boolean> {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('nwm-')).map((key) => caches.delete(key)));
  }
  return registrations.length > 0;
}

/** Repli `none` : à défaut d'identifiant de build, le worker ne cache rien
 *  plutôt que de figer un cache qui ne serait jamais renommé. */
const SW_VERSION = process.env.NEXT_PUBLIC_BUILD_ID || 'none';

/**
 * Enregistre le service worker (cf. public/sw.js) : c'est lui qui rend la
 * console installable et qui sert la page hors-ligne.
 *
 * Monté dans le layout racine, donc AUSSI sur /login et /setup : sans session,
 * un utilisateur peut installer l'app et se connecter ensuite depuis sa fenêtre.
 *
 * EN DEV, il est désinscrit au lieu d'être posé. Le cache d'assets du SW part du
 * principe qu'une URL de chunk change à chaque build — vrai en production, faux
 * sous `next dev`, qui réutilise `/_next/static/chunks/…` d'une compilation à
 * l'autre. Le SW resservait donc l'ancien bundle : on relit l'écran d'AVANT sa
 * propre modification, et rien ne le dit — ni erreur, ni log, la page est
 * simplement périmée. Un SW déjà installé survivant à la bascule, on le retire
 * (une console ouverte le garde sinon indéfiniment) et on recharge une fois,
 * puisque le worker actif continue de servir la page en cours jusqu'au prochain
 * chargement.
 *
 * EN PRODUCTION, l'URL porte l'identifiant du build. Le navigateur ne réinstalle
 * un worker que si les octets de son fichier changent, or `sw.js` est un fichier
 * statique identique d'un déploiement à l'autre : sans ce paramètre, aucun
 * nouveau worker n'est installé, les caches ne sont jamais renommés donc jamais
 * purgés, et une console installée continue de servir les assets du build
 * précédent — les icônes et la page hors-ligne ne portant aucune empreinte dans
 * leur URL, rien d'autre ne les invalide.
 */
export function PwaRegister() {
  React.useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production') {
      void unregisterServiceWorker()
        .then((removed) => {
          if (!removed || sessionStorage.getItem(RELOADED_KEY)) return;
          sessionStorage.setItem(RELOADED_KEY, '1');
          window.location.reload();
        })
        .catch(() => {
          // Rien à rattraper : au pire le dev garde un cache périmé, qu'il vide
          // à la main. Casser le rendu pour ça serait pire que le mal.
        });
      return;
    }

    const register = () => {
      navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(SW_VERSION)}`).catch(() => {
        // L'échec d'enregistrement ne doit rien casser : l'app reste utilisable
        // en ligne, seule l'installation est perdue.
      });
    };
    // Après `load` : l'enregistrement se dispute sinon la bande passante du
    // premier rendu, sur une console qui charge déjà son menu et ses données.
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
