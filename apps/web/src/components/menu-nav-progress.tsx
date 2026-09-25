'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { theme } from 'antd';

/** Durée de l'animation « remplissage » de la barre avant qu'elle ne stagne près de 100 %. */
const FILL_DURATION_MS = 10000;
/** Durée de l'animation de fin (la barre se complète puis disparaît). */
const FINISH_DURATION_MS = 280;
/** Filet de sécurité : si la navigation échoue, la barre ne reste pas affichée indéfiniment. */
const SAFETY_TIMEOUT_MS = 20000;

type Status = 'idle' | 'loading' | 'done';

/**
 * Barre de progression des navigations du menu. L'App Router n'expose pas d'événement de début
 * de navigation : on intercepte le clic sur les liens et on termine quand le `pathname` change.
 */
export function MenuNavProgress({ children }: { children: React.ReactNode }) {
  const { token } = theme.useToken();
  const pathname = usePathname();
  const [status, setStatus] = React.useState<Status>('idle');

  React.useEffect(() => {
    setStatus((current) => (current === 'loading' ? 'done' : current));
  }, [pathname]);

  React.useEffect(() => {
    if (status === 'idle') return undefined;
    const delay = status === 'done' ? FINISH_DURATION_MS : SAFETY_TIMEOUT_MS;
    const timer = window.setTimeout(() => setStatus('idle'), delay);
    return () => window.clearTimeout(timer);
  }, [status]);

  const handleClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    // Clic modifié ou bouton secondaire : le navigateur ouvre un onglet, pas de navigation ici.
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const link = (event.target as HTMLElement | null)?.closest('a');
    if (!link || !link.closest('.ant-menu')) return;
    if (link.target && link.target !== '_self') return;

    const href = link.getAttribute('href');
    if (!href?.startsWith('/')) return;
    if (href.split('?')[0] === pathname) return;

    setStatus('loading');
  };

  return (
    <div onClickCapture={handleClickCapture}>
      {status !== 'idle' && (
        <div
          role="progressbar"
          aria-label="Chargement de la page"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            zIndex: 2000,
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        >
          <style>
            {'@keyframes nwm-nav-progress-fill { from { transform: translateX(-80%) } to { transform: translateX(-8%) } }' +
              '@keyframes nwm-nav-progress-finish { from { opacity: 1 } to { transform: translateX(0); opacity: 0 } }'}
          </style>
          <div
            style={{
              height: '100%',
              background: token.colorPrimary,
              boxShadow: `0 0 8px ${token.colorPrimary}`,
              animation:
                status === 'done'
                  ? `nwm-nav-progress-finish ${FINISH_DURATION_MS}ms ease-out forwards`
                  : `nwm-nav-progress-fill ${FILL_DURATION_MS}ms cubic-bezier(0.15, 0.9, 0.3, 1) forwards`,
            }}
          />
        </div>
      )}
      {children}
    </div>
  );
}
