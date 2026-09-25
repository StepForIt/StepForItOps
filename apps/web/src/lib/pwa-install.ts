'use client';

import React from 'react';

/**
 * État d'installabilité de la console (PWA).
 *
 * `beforeinstallprompt` n'est tiré qu'UNE fois par chargement, et souvent avant
 * que React n'ait monté quoi que ce soit : l'événement est donc capté à
 * l'évaluation du module, et les composants s'abonnent ensuite à ce qui a déjà
 * été retenu. S'y abonner depuis un `useEffect` reviendrait à rater le seul
 * moment où le navigateur propose l'installation.
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Sans ce preventDefault, Chrome affiche sa propre bannière et l'événement
    // ne peut plus être rejoué depuis notre bouton.
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    notify();
  });
}

/** Déjà installée : la page tourne dans sa propre fenêtre, plus rien à proposer. */
function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** iOS n'implémente pas `beforeinstallprompt` : l'installation y est manuelle. */
function isIos(): boolean {
  if (typeof window === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(window.navigator.userAgent);
}

export type InstallState =
  { kind: 'unavailable' } | { kind: 'prompt'; install: () => Promise<void> } | { kind: 'manual-ios' };

export function useInstallState(): InstallState {
  const [, forceRender] = React.useReducer((count: number) => count + 1, 0);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    listeners.add(forceRender);
    return () => {
      listeners.delete(forceRender);
    };
  }, []);

  // Le rendu serveur ne sait rien du navigateur : on ne décide qu'une fois monté.
  if (!mounted || installed || isStandalone()) return { kind: 'unavailable' };
  if (deferred) {
    const event = deferred;
    return {
      kind: 'prompt',
      install: async () => {
        await event.prompt();
        const { outcome } = await event.userChoice;
        // Un prompt est à usage unique : refusé, il faudra un nouveau chargement.
        deferred = null;
        installed = outcome === 'accepted';
        notify();
      },
    };
  }
  return isIos() ? { kind: 'manual-ios' } : { kind: 'unavailable' };
}
