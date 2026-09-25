'use client';

import React from 'react';

/** Distance minimale d'un glissé, et part de l'écran où il doit commencer. */
const MIN_DISTANCE = 70;
const START_ZONE = 0.35;
/** Le bord même appartient au geste « retour » du système : on le laisse tranquille. */
const SYSTEM_EDGE = 28;

/**
 * Un glissé vers la GAUCHE, parti de la droite de l'écran, appelle `onOpen` —
 * le geste qui tire un panneau depuis ce bord.
 *
 * Il ne part pas du bord lui-même : sur Android comme sur iOS, les 20 à 30
 * premiers pixels sont pris par le geste « retour » du système, et le disputer
 * ne donnerait qu'un geste qui marche une fois sur deux. Un mouvement plus
 * vertical qu'horizontal est un défilement, pas un glissé.
 */
export function useSwipeOpen(onOpen: () => void, enabled: boolean): void {
  React.useEffect(() => {
    if (!enabled) return undefined;
    let startX = 0;
    let startY = 0;
    let candidate = false;

    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      const width = window.innerWidth;
      candidate = touch.clientX > width * (1 - START_ZONE) && touch.clientX < width - SYSTEM_EDGE;
      startX = touch.clientX;
      startY = touch.clientY;
    };
    const onEnd = (event: TouchEvent) => {
      if (!candidate) return;
      candidate = false;
      const touch = event.changedTouches[0];
      const dx = startX - touch.clientX;
      const dy = Math.abs(startY - touch.clientY);
      if (dx > MIN_DISTANCE && dx > dy * 2) onOpen();
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchend', onEnd);
    };
  }, [onOpen, enabled]);
}
