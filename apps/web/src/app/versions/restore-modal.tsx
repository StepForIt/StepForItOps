'use client';

import React from 'react';
import { Alert, Descriptions, Modal, Skeleton, Space, Tag, Typography } from 'antd';
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

/** Les mots de chaque plateforme : un scénario Make n'a pas de nœuds. */
const VOCAB = {
  n8n: { platform: 'n8n', items: 'nœuds', Items: 'Nœuds' },
  make: { platform: 'Make', items: 'modules', Items: 'Modules' },
} as const;

const fr = (iso: string) => new Date(iso).toLocaleString('fr-FR');

function NodeList({ label, names, color }: { label: string; names: string[]; color: string }) {
  if (names.length === 0) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {label} ({names.length}) :{' '}
      </Typography.Text>
      {names.slice(0, 8).map((name) => (
        <Tag key={name} color={color} style={{ marginBottom: 4 }}>
          {name}
        </Tag>
      ))}
      {names.length > 8 && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          +{names.length - 8} autres
        </Typography.Text>
      )}
    </div>
  );
}

/** Confirmation d'une restauration : montre ce qui sera écrasé sur la plateforme du workflow. */
export function RestoreModal({ versionId, onClose }: { versionId: string | null; onClose: () => void }) {
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

  const vocab = VOCAB[preview?.platform ?? 'n8n'];
  const changed = preview
    ? preview.nodes.added.length + preview.nodes.removed.length + preview.nodes.modified.length
    : 0;
  const otherChanges = [
    preview?.otherChanges.connections ? 'les connexions' : null,
    preview?.otherChanges.settings ? 'les réglages' : null,
  ].filter((label): label is string => label !== null);

  return (
    <Modal
      title={preview ? `Restaurer cette version vers ${vocab.platform}` : 'Restaurer cette version'}
      open={versionId !== null}
      onCancel={onClose}
      width={680}
      okText={done ? 'Fermer' : `Restaurer — écraser dans ${vocab.platform}`}
      cancelText="Annuler"
      okButtonProps={{ danger: !done, loading: running, disabled: loading || (!done && !preview) }}
      cancelButtonProps={{ style: done ? { display: 'none' } : undefined }}
      onOk={done ? onClose : run}
    >
      {loading && <Skeleton active />}

      {preview && !done && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {preview.identicalToCurrent ? (
            <Alert type="info" showIcon message="Identique : sans effet." />
          ) : (
            <Alert
              type="warning"
              showIcon
              message={
                <>
                  Écrase « {preview.workflow.name} » sur {preview.instance.name}. Modifs {vocab.platform}{' '}
                  depuis le {fr(preview.createdAt)} perdues.
                </>
              }
            />
          )}

          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="Version restaurée">
              <code>{preview.hash.slice(0, 10)}</code> — {fr(preview.createdAt)} <Tag>{preview.origin}</Tag>
              {preview.message && <Typography.Text type="secondary">{preview.message}</Typography.Text>}
            </Descriptions.Item>
            {!preview.isLatest && (
              <Descriptions.Item label="Versions plus récentes">
                <Tag color="orange">{preview.versionsAfter} contournée(s)</Tag>
              </Descriptions.Item>
            )}
            {!preview.identicalToCurrent && (
              <Descriptions.Item label={vocab.Items}>
                {preview.nodes.current} → {preview.nodes.restored}
                {changed === 0 && (
                  <Typography.Text type="secondary">
                    {' '}
                    — {vocab.items} inchangés
                    {otherChanges.length > 0 ? ` ; diffère : ${otherChanges.join(', ')}` : ''}
                  </Typography.Text>
                )}
                <NodeList label="Ajoutés" names={preview.nodes.added} color="green" />
                <NodeList label="Supprimés" names={preview.nodes.removed} color="red" />
                <NodeList label="Modifiés" names={preview.nodes.modified} color="blue" />
                {changed > 0 && otherChanges.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Également modifié : {otherChanges.join(', ')}.
                    </Typography.Text>
                  </div>
                )}
              </Descriptions.Item>
            )}
            {preview.renameTo && (
              <Descriptions.Item label="Renommage">
                <Tag color="orange">
                  « {preview.workflow.name} » → « {preview.renameTo} »
                </Tag>
              </Descriptions.Item>
            )}
          </Descriptions>

          {preview.workflow.active && (
            <Alert
              type="error"
              showIcon
              message={`Actif sur ${vocab.platform} : la version restaurée tournera dès le prochain déclenchement.`}
            />
          )}

          {preview.notes.length > 0 && (
            <Alert
              type="warning"
              showIcon
              message="À savoir avant de restaurer"
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {preview.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              }
            />
          )}

          {preview.archived && (
            <Alert
              type="error"
              showIcon
              message="Archivé côté n8n : la restauration échouera. Désarchive-le d'abord."
            />
          )}
        </Space>
      )}

      {done && <Alert type="success" showIcon message={`Version restaurée vers ${vocab.platform}`} />}

      {error && (
        <Alert
          style={{ marginTop: 12 }}
          type="error"
          showIcon
          message="Restauration impossible"
          description={error}
        />
      )}
    </Modal>
  );
}
