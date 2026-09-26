'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from 'antd';
import { useBack } from '@refinedev/core';

/**
 * Bouton « Annuler » pour les pages Refine `<Create>` / `<Edit>`, qui ne rendent
 * qu'un « Enregistrer » — la seule sortie étant sinon la flèche retour de l'en-tête,
 * loin du bouton principal. Placé À CÔTÉ de « Enregistrer » via `footerButtons`,
 * il revient en arrière sans rien écrire.
 */
export function FormCancelButton() {
  const back = useBack();
  const t = useTranslations('common');
  return <Button onClick={() => back()}>{t('cancel')}</Button>;
}

/**
 * Prêt à passer tel quel à `footerButtons` d'un `<Create>` / `<Edit>` : place le
 * bouton « Annuler » avant les boutons par défaut (« Enregistrer »).
 */
export function formFooterButtons({ defaultButtons }: { defaultButtons: React.ReactNode }) {
  return (
    <>
      <FormCancelButton />
      {defaultButtons}
    </>
  );
}
