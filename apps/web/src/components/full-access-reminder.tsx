'use client';

import React, { useState } from 'react';
import { Alert, Button, Space, Typography, message } from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import { apiPatch } from '../lib/api';
import { useEnabledModules } from '../lib/enabled-modules';
import {
  adminModuleEnabled,
  needsFullAccessPrompt,
  type FullAccessOutcome,
  type FullAccessState,
} from '../lib/full-access/full-access-prompt';
import { FullAccessModal } from './full-access-modal';

export interface FullAccessInstance extends FullAccessState {
  id: string;
  name: string;
  fullAccessDismissedBy?: string | null;
}

/**
 * Sur la fiche d'une instance déjà enregistrée : un bandeau tant que le compte
 * propriétaire manque et que personne n'a refusé ; après un refus, une ligne
 * discrète qui permet de le lever. Le refus est écrit sur l'instance par la
 * même route que le formulaire (`fullAccessDismiss`), jamais en local.
 */
export function FullAccessReminder({
  instance,
  onChanged,
}: {
  instance: FullAccessInstance;
  onChanged: () => void;
}) {
  const t = useTranslations('settings.fullAccess');
  const locale = useLocale();
  const { enabled } = useEnabledModules();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const adminEnabled = adminModuleEnabled(enabled);
  if (!adminEnabled || instance.platform !== 'n8n' || instance.hasN8nLogin) return null;

  const patch = async (body: object, done: string) => {
    setBusy(true);
    try {
      await apiPatch(`/instances/${instance.id}`, body);
      message.success(done);
      onChanged();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onOutcome = async (outcome: FullAccessOutcome) => {
    if (outcome.kind === 'with') {
      await patch({ n8nEmail: outcome.n8nEmail, n8nPassword: outcome.n8nPassword }, t('saved'));
    } else if (outcome.kind === 'without' && outcome.dismiss) {
      await patch({ fullAccessDismiss: true }, t('dismissed'));
    }
    setOpen(false);
  };

  if (!needsFullAccessPrompt({ ...instance, adminEnabled })) {
    const date = instance.fullAccessDismissedAt
      ? new Date(instance.fullAccessDismissedAt).toLocaleDateString(locale)
      : '';
    return (
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 16 }}>
        {t('dismissedOn', { date })}
        {instance.fullAccessDismissedBy ? t('dismissedBy', { by: instance.fullAccessDismissedBy }) : ''}
        {' · '}
        {/* Un bouton et non un lien sans adresse : sans `href`, une ancre n'est annoncée par aucun lecteur d'écran. */}
        <Button
          type="link"
          size="small"
          style={{ padding: 0, height: 'auto', fontSize: 12 }}
          disabled={busy}
          onClick={() => patch({ fullAccessDismiss: false }, t('askedAgain'))}
        >
          {t('askAgain')}
        </Button>
      </Typography.Paragraph>
    );
  }

  return (
    <>
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message={t('banner', { name: instance.name })}
        action={
          <Space>
            <Button size="small" type="primary" onClick={() => setOpen(true)}>
              {t('fill')}
            </Button>
            <Button
              size="small"
              disabled={busy}
              onClick={() => patch({ fullAccessDismiss: true }, t('dismissed'))}
            >
              {t('dismiss')}
            </Button>
          </Space>
        }
      />
      <FullAccessModal open={open} busy={busy} onOutcome={onOutcome} />
    </>
  );
}
