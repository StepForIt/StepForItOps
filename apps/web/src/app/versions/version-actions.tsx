'use client';

import React from 'react';
import { Button, Space } from 'antd';
import { useTranslations } from 'next-intl';

/** Ce qu'on peut faire d'une version, où qu'elle soit affichée. */
export interface VersionHandlers {
  onDiff: (versionId: string) => void;
  onExport: (versionId: string) => void;
  onRestore: (versionId: string) => void;
}

export function VersionActions({ versionId, handlers }: { versionId: string; handlers: VersionHandlers }) {
  const t = useTranslations('inventory.versions.actions');
  return (
    <Space>
      <Button size="small" onClick={() => handlers.onDiff(versionId)}>
        {t('compare')}
      </Button>
      <Button size="small" onClick={() => handlers.onExport(versionId)}>
        {t('export')}
      </Button>
      <Button size="small" danger onClick={() => handlers.onRestore(versionId)}>
        {t('restore')}
      </Button>
    </Space>
  );
}

/** Date d'export, ou « jamais » : même rendu dans les deux vues. */
export const formatDateTime = (iso: string, locale: string) => new Date(iso).toLocaleString(locale);
