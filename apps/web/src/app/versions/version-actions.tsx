'use client';

import React from 'react';
import { Button, Space } from 'antd';

/** Ce qu'on peut faire d'une version, où qu'elle soit affichée. */
export interface VersionHandlers {
  onDiff: (versionId: string) => void;
  onExport: (versionId: string) => void;
  onRestore: (versionId: string) => void;
}

export function VersionActions({ versionId, handlers }: { versionId: string; handlers: VersionHandlers }) {
  return (
    <Space>
      <Button size="small" onClick={() => handlers.onDiff(versionId)}>
        Comparer
      </Button>
      <Button size="small" onClick={() => handlers.onExport(versionId)}>
        Exporter
      </Button>
      <Button size="small" danger onClick={() => handlers.onRestore(versionId)}>
        Restaurer
      </Button>
    </Space>
  );
}

/** Date d'export, ou « jamais » : même rendu dans les deux vues. */
export const frDate = (iso: string) => new Date(iso).toLocaleString('fr-FR');
