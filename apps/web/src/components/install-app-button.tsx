'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('shell.installApp');
  const state = useInstallState();
  const [iosOpen, setIosOpen] = React.useState(false);

  if (state.kind === 'unavailable') return null;

  const onClick = () => {
    if (state.kind === 'prompt') void state.install();
    else setIosOpen(true);
  };

  const button = collapsed ? (
    <Tooltip placement="right" title={t('button')}>
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
        {t('button')}
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
        title={t('iosTitle')}
        okText={t('iosOk')}
        cancelButtonProps={{ style: { display: 'none' } }}
      >
        <Paragraph>{t('iosIntro')}</Paragraph>
        <Paragraph>
          {t.rich('iosStep1', { b: (chunks) => <Text strong>{chunks}</Text> })}
          <br />
          {t.rich('iosStep2', { b: (chunks) => <Text strong>{chunks}</Text> })}
        </Paragraph>
      </Modal>
    </>
  );
}
