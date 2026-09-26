'use client';

import React from 'react';
import { Alert, Descriptions, Modal, Skeleton, Space, Tag, Typography } from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import { apiGet, apiPost } from '../../lib/api';

interface RestorePreview {
  versionId: string;
  platform: 'n8n' | 'make';
  hash: string;
  createdAt: string;
  origin: string;
  message: string | null;
  workflow: { id: string; name: string; externalId: string; active: boolean; syncedAt: string };
  instance: { id: string; name: string; baseUrl: string };
  identicalToCurrent: boolean;
  isLatest: boolean;
  versionsAfter: number;
  archived: boolean;
  renameTo: string | null;
  nodes: { current: number; restored: number; added: string[]; removed: string[]; modified: string[] };
  otherChanges: { connections: boolean; settings: boolean };
  notes: string[];
}

/** Le nom de chaque plateforme ; ses mots (nœuds, modules) sont dans les messages. */
const PLATFORM_NAME = { n8n: 'n8n', make: 'Make' } as const;

function NodeList({ label, names, color }: { label: string; names: string[]; color: string }) {
  const t = useTranslations('inventory.versions.restore');
  if (names.length === 0) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t('nodeList', { label, count: names.length })}{' '}
      </Typography.Text>
      {names.slice(0, 8).map((name) => (
        <Tag key={name} color={color} style={{ marginBottom: 4 }}>
          {name}
        </Tag>
      ))}
      {names.length > 8 && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('more', { count: names.length - 8 })}
        </Typography.Text>
      )}
    </div>
  );
}

/** Confirmation d'une restauration : montre ce qui sera écrasé sur la plateforme du workflow. */
export function RestoreModal({ versionId, onClose }: { versionId: string | null; onClose: () => void }) {
  const t = useTranslations('inventory.versions.restore');
  const locale = useLocale();
  const fr = (iso: string) => new Date(iso).toLocaleString(locale);
  const [preview, setPreview] = React.useState<RestorePreview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  React.useEffect(() => {
    setPreview(null);
    setError(null);
    setDone(false);
    if (!versionId) return;
    setLoading(true);
    apiGet<RestorePreview>(`/versions/${versionId}/restore-preview`)
      .then(setPreview)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [versionId]);

  const run = async () => {
    if (!versionId) return;
    setRunning(true);
    setError(null);
    try {
      await apiPost(`/versions/${versionId}/restore`);
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const platformId = preview?.platform ?? 'n8n';
  const platform = PLATFORM_NAME[platformId];
  const changed = preview
    ? preview.nodes.added.length + preview.nodes.removed.length + preview.nodes.modified.length
    : 0;
  const otherChanges = [
    preview?.otherChanges.connections ? t('connections') : null,
    preview?.otherChanges.settings ? t('settings') : null,
  ].filter((label): label is string => label !== null);

  return (
    <Modal
      title={preview ? t('titleTo', { platform }) : t('title')}
      open={versionId !== null}
      onCancel={onClose}
      width={680}
      okText={done ? t('close') : t('ok', { platform })}
      cancelText={t('cancel')}
      okButtonProps={{ danger: !done, loading: running, disabled: loading || (!done && !preview) }}
      cancelButtonProps={{ style: done ? { display: 'none' } : undefined }}
      onOk={done ? onClose : run}
    >
      {loading && <Skeleton active />}

      {preview && !done && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {preview.identicalToCurrent ? (
            <Alert type="info" showIcon message={t('identical')} />
          ) : (
            <Alert
              type="warning"
              showIcon
              message={t('overwrite', {
                name: preview.workflow.name,
                instance: preview.instance.name,
                platform,
                date: fr(preview.createdAt),
              })}
            />
          )}

          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label={t('restoredVersion')}>
              <code>{preview.hash.slice(0, 10)}</code> — {fr(preview.createdAt)} <Tag>{preview.origin}</Tag>
              {preview.message && <Typography.Text type="secondary">{preview.message}</Typography.Text>}
            </Descriptions.Item>
            {!preview.isLatest && (
              <Descriptions.Item label={t('newerVersions')}>
                <Tag color="orange">{t('bypassed', { count: preview.versionsAfter })}</Tag>
              </Descriptions.Item>
            )}
            {!preview.identicalToCurrent && (
              <Descriptions.Item label={t(`itemsTitle.${platformId}`)}>
                {preview.nodes.current} → {preview.nodes.restored}
                {changed === 0 && (
                  <Typography.Text type="secondary">
                    {' '}
                    {t('unchanged', { items: t(`items.${platformId}`) })}
                    {otherChanges.length > 0 ? t('differs', { list: otherChanges.join(', ') }) : ''}
                  </Typography.Text>
                )}
                <NodeList label={t('added')} names={preview.nodes.added} color="green" />
                <NodeList label={t('removed')} names={preview.nodes.removed} color="red" />
                <NodeList label={t('modified')} names={preview.nodes.modified} color="blue" />
                {changed > 0 && otherChanges.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t('alsoChanged', { list: otherChanges.join(', ') })}
                    </Typography.Text>
                  </div>
                )}
              </Descriptions.Item>
            )}
            {preview.renameTo && (
              <Descriptions.Item label={t('rename')}>
                <Tag color="orange">
                  {t('renameTag', { from: preview.workflow.name, to: preview.renameTo })}
                </Tag>
              </Descriptions.Item>
            )}
          </Descriptions>

          {preview.workflow.active && <Alert type="error" showIcon message={t('active', { platform })} />}

          {preview.notes.length > 0 && (
            <Alert
              type="warning"
              showIcon
              message={t('notesTitle')}
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {preview.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              }
            />
          )}

          {preview.archived && <Alert type="error" showIcon message={t('archived')} />}
        </Space>
      )}

      {done && <Alert type="success" showIcon message={t('done', { platform })} />}

      {error && (
        <Alert style={{ marginTop: 12 }} type="error" showIcon message={t('failed')} description={error} />
      )}
    </Modal>
  );
}
