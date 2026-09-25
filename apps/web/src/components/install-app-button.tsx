'use client';

import React from 'react';
import { Button, Modal, Tooltip, Typography } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useInstallState } from '../lib/pwa-install';

const { Paragraph, Text } = Typography;

/**
 * Entrée « Installer l'app » du menu latéral.
 *
 * Invisible tant que le navigateur ne propose rien : ni une fois l'app
 * installée, ni sur un navigateur qui ne sait pas installer. Sur iOS, où
 * l'installation ne peut être déclenchée que par l'utilisateur, le bouton
 * explique le geste au lieu de disparaître.
 */
export function InstallAppButton({ collapsed }: { collapsed: boolean }) {
  const state = useInstallState();
  const [iosOpen, setIosOpen] = React.useState(false);

  if (state.kind === 'unavailable') return null;

  const onClick = () => {
    if (state.kind === 'prompt') void state.install();
    else setIosOpen(true);
  };

  const button = collapsed ? (
    <Tooltip placement="right" title="Installer l'app">
      <div style={{ textAlign: 'center', padding: '8px 0' }}>
        <Button type="text" size="small" icon={<DownloadOutlined />} onClick={onClick} />
      </div>
    </Tooltip>
  ) : (
    <div style={{ padding: '8px 12px 0' }}>
      <Button
        type="text"
        size="small"
        icon={<DownloadOutlined />}
        onClick={onClick}
        style={{ paddingLeft: 0 }}
      >
        Installer l&apos;app
      </Button>
    </div>
  );

  return (
    <>
      {button}
      <Modal
        open={iosOpen}
        onCancel={() => setIosOpen(false)}
        onOk={() => setIosOpen(false)}
        title="Installer sur l'écran d'accueil"
        okText="Compris"
        cancelButtonProps={{ style: { display: 'none' } }}
      >
        <Paragraph>
          Safari ne propose pas l&apos;installation automatiquement : elle se fait en deux gestes.
        </Paragraph>
        <Paragraph>
          1. Touche le bouton <Text strong>Partager</Text> de la barre du navigateur.
          <br />
          2. Choisis <Text strong>Sur l&apos;écran d&apos;accueil</Text>.
        </Paragraph>
      </Modal>
    </>
  );
}
