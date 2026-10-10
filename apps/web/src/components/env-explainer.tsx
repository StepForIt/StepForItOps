'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Button, Card, Typography } from 'antd';
import { BulbOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { BRAND } from '../lib/brand/colors';

const strong = (chunks: React.ReactNode) => <strong>{chunks}</strong>;

/**
 * À quoi servent les environnements et les correspondances test / réel, dit par le GAIN
 * avant la mécanique : un utilisateur qui n'a jamais déclaré d'env ne sait ni ce qu'il y
 * gagne, ni par où commencer. Le même bloc sert la page des correspondances, leur
 * formulaire et l'assistant d'env — une seule rédaction à tenir à jour.
 */
export function EnvExplainer({
  defaultOpen = false,
  compact = false,
}: {
  defaultOpen?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations('settings.envExplainer');
  const [open, setOpen] = useState(defaultOpen);

  if (!open) {
    return (
      <div>
        <Button type="link" icon={<BulbOutlined />} onClick={() => setOpen(true)} style={{ paddingLeft: 0 }}>
          {t('show')}
        </Button>
      </div>
    );
  }

  return (
    <Card
      size="small"
      style={{ marginBottom: 16, borderLeft: `4px solid ${BRAND.primary}` }}
      title={
        <span>
          <BulbOutlined /> {t('title')}
        </span>
      }
      extra={
        <Button type="text" size="small" onClick={() => setOpen(false)}>
          {t('hide')}
        </Button>
      }
    >
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        {t('tagline')}
      </Typography.Title>
      <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
        <li>{t.rich('gains.safe', { strong })}</li>
        <li>{t.rich('gains.checks', { strong })}</li>
        <li>{t.rich('gains.versions', { strong })}</li>
      </ul>
      {!compact && (
        <>
          <Typography.Text strong>{t('mappingTitle')}</Typography.Text>
          <Typography.Paragraph style={{ marginBottom: 12 }}>{t('mappingText')}</Typography.Paragraph>
          <Typography.Text strong>{t('stepsTitle')}</Typography.Text>
          <ol style={{ paddingLeft: 20, marginBottom: 8 }}>
            <li>{t.rich('steps.copy', { strong })}</li>
            <li>{t.rich('steps.link', { strong })}</li>
            <li>{t.rich('steps.promote', { strong })}</li>
          </ol>
        </>
      )}
      <Link href="/aide?tip=env-why">{t('seeAnimation')}</Link>
    </Card>
  );
}
