'use client';

import React, { useState } from 'react';
import { App, Button, Input, List, Modal, Popover, Space, Tag, Tooltip, Typography } from 'antd';
import { LockOutlined, UnlockOutlined } from '@ant-design/icons';
import { apiGet } from '../lib/api';
import { useWorkflowLocks } from '../lib/workflow-lock/workflow-locks';

interface LockOverrideRow {
  id: string;
  action: string;
  reason: string;
  author: string | null;
  createdAt: string;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

/** Petit cadenas des listes et des onglets d'env : rien quand l'exemplaire est libre. */
export function LockIcon({ workflowId }: { workflowId: string }) {
  const { lockOf } = useWorkflowLocks();
  const lock = lockOf(workflowId);
  if (!lock) return null;
  return (
    <Tooltip title={lock.lockedBy ? `Verrouillé par ${lock.lockedBy}` : 'Verrouillé'}>
      <LockOutlined aria-label="Verrouillé" style={{ color: 'var(--ant-color-warning, #faad14)' }} />
    </Tooltip>
  );
}

/** Le verrou sur la fiche : qui, quand, pourquoi, et les forçages passés. */
export function WorkflowLockTag({ workflowId }: { workflowId: string }) {
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
      title="Verrouillé"
      content={
        <Space direction="vertical" style={{ maxWidth: 360 }}>
          <Typography.Text type="secondary">
            {lock.lockedBy ? `Par ${lock.lockedBy}, ` : ''}le {formatDate(lock.lockedAt)}
          </Typography.Text>
          {lock.note && <Typography.Text>{lock.note}</Typography.Text>}
          <Typography.Text strong>Forçages</Typography.Text>
          <List
            size="small"
            loading={overrides === null}
            locale={{ emptyText: 'Aucun' }}
            dataSource={overrides ?? []}
            renderItem={(row) => (
              <List.Item style={{ paddingInline: 0 }}>
                <Space direction="vertical" size={0}>
                  <Typography.Text>{row.reason}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {formatDate(row.createdAt)}
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
                () => message.success('Déverrouillé'),
                (error: Error) => message.error(error.message),
              )
            }
          >
            Déverrouiller
          </Button>
        </Space>
      }
    >
      <Tag color="gold" icon={<LockOutlined />} style={{ cursor: 'pointer' }}>
        verrouillé
      </Tag>
    </Popover>
  );
}

/** L'entrée « Verrouiller » / « Déverrouiller » du menu « ⋯ », et la modale qui demande une note. */
export function useLockAction(workflowId: string) {
  const { isLocked, lock, unlock } = useWorkflowLocks();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const locked = isLocked(workflowId);

  const action = locked
    ? {
        key: 'unlock',
        label: 'Déverrouiller',
        icon: <UnlockOutlined />,
        onClick: () =>
          unlock(workflowId).then(
            () => message.success('Déverrouillé'),
            (error: Error) => message.error(error.message),
          ),
      }
    : {
        key: 'lock',
        label: 'Verrouiller',
        icon: <LockOutlined />,
        hint: 'Plus aucune écriture de la plateforme sans forçage justifié',
        onClick: () => {
          setNote('');
          setOpen(true);
        },
      };

  const modal = (
    <Modal
      open={open}
      title="Verrouiller ce workflow"
      okText="Verrouiller"
      cancelText="Annuler"
      onCancel={() => setOpen(false)}
      onOk={() =>
        lock(workflowId, note).then(
          () => {
            setOpen(false);
            message.success('Verrouillé');
          },
          (error: Error) => message.error(error.message),
        )
      }
      destroyOnHidden
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Typography.Text type="secondary">
          Promotions, assistant IA, restaurations, renommages, publication, archivage et procédures
          demanderont une raison. Une édition faite directement dans n8n n’est pas bloquée.
        </Typography.Text>
        <Input.TextArea
          rows={2}
          maxLength={500}
          placeholder="Note (facultative)"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Space>
    </Modal>
  );

  return { action, modal };
}
