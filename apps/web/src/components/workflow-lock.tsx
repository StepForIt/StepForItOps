'use client';

import React, { useState } from 'react';
import { App, Button, Input, List, Modal, Popover, Space, Tag, Tooltip, Typography } from 'antd';
import { LockOutlined, UnlockOutlined } from '@ant-design/icons';
import { useLocale, useTranslations } from 'next-intl';
import { apiGet } from '../lib/api';
import { useWorkflowLocks } from '../lib/workflow-lock/workflow-locks';

interface LockOverrideRow {
  id: string;
  action: string;
  reason: string;
  author: string | null;
  createdAt: string;
}

const formatDate = (iso: string, locale: string) =>
  new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });

/** Petit cadenas des listes et des onglets d'env : rien quand l'exemplaire est libre. */
export function LockIcon({ workflowId }: { workflowId: string }) {
  const t = useTranslations('reviewTools.lock');
  const { lockOf } = useWorkflowLocks();
  const lock = lockOf(workflowId);
  if (!lock) return null;
  return (
    <Tooltip title={lock.lockedBy ? t('lockedBy', { user: lock.lockedBy }) : t('locked')}>
      <LockOutlined aria-label={t('locked')} style={{ color: 'var(--ant-color-warning, #faad14)' }} />
    </Tooltip>
  );
}

/** Le verrou sur la fiche : qui, quand, pourquoi, et les forçages passés. */
export function WorkflowLockTag({ workflowId }: { workflowId: string }) {
  const t = useTranslations('reviewTools.lock');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const { lockOf, unlock } = useWorkflowLocks();
  const { message } = App.useApp();
  const [overrides, setOverrides] = useState<LockOverrideRow[] | null>(null);
  const lock = lockOf(workflowId);
  if (!lock) return null;

  const load = (open: boolean) => {
    if (!open) return;
    apiGet<{ overrides: LockOverrideRow[] }>(`/workflow-locks/${workflowId}`)
      .then((detail) => setOverrides(detail.overrides))
      .catch(() => setOverrides([]));
  };

  return (
    <Popover
      trigger="click"
      onOpenChange={load}
      title={t('locked')}
      content={
        <Space direction="vertical" style={{ maxWidth: 360 }}>
          <Typography.Text type="secondary">
            {lock.lockedBy
              ? t('lockedAtBy', { user: lock.lockedBy, date: formatDate(lock.lockedAt, locale) })
              : t('lockedAt', { date: formatDate(lock.lockedAt, locale) })}
          </Typography.Text>
          {lock.note && <Typography.Text>{lock.note}</Typography.Text>}
          <Typography.Text strong>{t('overrides')}</Typography.Text>
          <List
            size="small"
            loading={overrides === null}
            locale={{ emptyText: tCommon('none') }}
            dataSource={overrides ?? []}
            renderItem={(row) => (
              <List.Item style={{ paddingInline: 0 }}>
                <Space direction="vertical" size={0}>
                  <Typography.Text>{row.reason}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {formatDate(row.createdAt, locale)}
                    {row.author ? ` · ${row.author}` : ''} · {row.action}
                  </Typography.Text>
                </Space>
              </List.Item>
            )}
          />
          <Button
            size="small"
            icon={<UnlockOutlined />}
            onClick={() =>
              unlock(workflowId).then(
                () => message.success(t('unlocked')),
                (error: Error) => message.error(error.message),
              )
            }
          >
            {t('unlock')}
          </Button>
        </Space>
      }
    >
      <Tag color="gold" icon={<LockOutlined />} style={{ cursor: 'pointer' }}>
        {t('lockedTag')}
      </Tag>
    </Popover>
  );
}

/** L'entrée « Verrouiller » / « Déverrouiller » du menu « ⋯ », et la modale qui demande une note. */
export function useLockAction(workflowId: string) {
  const t = useTranslations('reviewTools.lock');
  const tCommon = useTranslations('common');
  const { isLocked, lock, unlock } = useWorkflowLocks();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const locked = isLocked(workflowId);

  const action = locked
    ? {
        key: 'unlock',
        label: t('unlock'),
        icon: <UnlockOutlined />,
        onClick: () =>
          unlock(workflowId).then(
            () => message.success(t('unlocked')),
            (error: Error) => message.error(error.message),
          ),
      }
    : {
        key: 'lock',
        label: t('lock'),
        icon: <LockOutlined />,
        hint: t('lockHint'),
        onClick: () => {
          setNote('');
          setOpen(true);
        },
      };

  const modal = (
    <Modal
      open={open}
      title={t('lockTitle')}
      okText={t('lock')}
      cancelText={tCommon('cancel')}
      onCancel={() => setOpen(false)}
      onOk={() =>
        lock(workflowId, note).then(
          () => {
            setOpen(false);
            message.success(t('locked'));
          },
          (error: Error) => message.error(error.message),
        )
      }
      destroyOnHidden
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Typography.Text type="secondary">{t('lockDescription')}</Typography.Text>
        <Input.TextArea
          rows={2}
          maxLength={500}
          placeholder={t('notePlaceholder')}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Space>
    </Modal>
  );

  return { action, modal };
}
