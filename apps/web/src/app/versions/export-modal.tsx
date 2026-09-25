'use client';

import React from 'react';
import { Alert, Descriptions, List, Modal, Skeleton, Space, Tag, Typography } from 'antd';
import { GithubOutlined, CloudOutlined } from '@ant-design/icons';
import { apiGet, apiPost } from '../../lib/api';

interface ExportPreview {
  versionId: string;
  hash: string;
  workflowName: string;
  instanceName: string;
  fileName: string;
  sizeBytes: number;
  alreadyExported: { at: string; to: string[] } | null;
  targets: Array<{
    id: string;
    name: string;
    kind: string;
    destination: string;
    movedFrom: string | null;
  }>;
}

const fr = (iso: string) => new Date(iso).toLocaleString('fr-FR');
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} Ko`;

/** Explique où part le JSON de la version avant de confirmer l'export. */
export function ExportModal({ versionId, onClose }: { versionId: string | null; onClose: () => void }) {
  const [preview, setPreview] = React.useState<ExportPreview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<string[] | null>(null);

  React.useEffect(() => {
    setPreview(null);
    setError(null);
    setResult(null);
    if (!versionId) return;
    setLoading(true);
    apiGet<ExportPreview>(`/versions/${versionId}/export-preview`)
      .then(setPreview)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [versionId]);

  const run = async () => {
    if (!versionId) return;
    setRunning(true);
    setError(null);
    try {
      const response = await apiPost<{ exported: string[] }>(`/versions/${versionId}/export`);
      setResult(response.exported);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const noTarget = preview !== null && preview.targets.length === 0;

  return (
    <Modal
      title="Exporter cette version"
      open={versionId !== null}
      onCancel={onClose}
      width={640}
      okText={result ? 'Fermer' : 'Exporter'}
      cancelText="Annuler"
      okButtonProps={{
        loading: running,
        disabled: loading || (!result && (!preview || noTarget)),
      }}
      cancelButtonProps={{ style: result ? { display: 'none' } : undefined }}
      onOk={result ? onClose : run}
    >
      {loading && <Skeleton active />}

      {preview && !result && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="Workflow">
              {preview.workflowName}{' '}
              <Typography.Text type="secondary">({preview.instanceName})</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="Version">
              <code>{preview.hash.slice(0, 10)}</code>
            </Descriptions.Item>
            <Descriptions.Item label="Fichier écrit">
              <code>{preview.fileName}</code>{' '}
              <Typography.Text type="secondary">({kb(preview.sizeBytes)})</Typography.Text>
            </Descriptions.Item>
            {preview.alreadyExported && (
              <Descriptions.Item label="Déjà exportée">
                <Tag color="green">
                  {fr(preview.alreadyExported.at)} → {preview.alreadyExported.to.join(', ')}
                </Tag>
              </Descriptions.Item>
            )}
          </Descriptions>

          {noTarget ? (
            <Alert
              type="warning"
              showIcon
              message="Aucune cible d'export active"
              description="Configure une cible GitHub ou Google Drive dans « Cibles export » avant d'exporter."
            />
          ) : (
            <>
              <Typography.Text strong>Cibles qui vont recevoir le fichier</Typography.Text>
              <List
                size="small"
                bordered
                dataSource={preview.targets}
                renderItem={(target) => (
                  <List.Item>
                    <List.Item.Meta
                      avatar={
                        <span style={{ fontSize: 18, color: '#1677ff' }}>
                          {target.kind === 'github' ? <GithubOutlined /> : <CloudOutlined />}
                        </span>
                      }
                      title={target.name}
                      description={
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {target.destination}
                          {target.movedFrom && (
                            <>
                              <br />
                              Déplacé depuis <code>{target.movedFrom}</code> (l&apos;ancien fichier est
                              supprimé)
                            </>
                          )}
                        </Typography.Text>
                      }
                    />
                  </List.Item>
                )}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Sans credentials
              </Typography.Text>
            </>
          )}
        </Space>
      )}

      {result && (
        <Alert
          type={result.length ? 'success' : 'warning'}
          showIcon
          message={
            result.length ? `Exporté vers : ${result.join(', ')}` : 'Aucune cible n’a accepté l’export'
          }
          description={
            result.length
              ? undefined
              : 'Vérifie les identifiants et les droits des cibles dans « Cibles export ».'
          }
        />
      )}

      {error && (
        <Alert style={{ marginTop: 12 }} type="error" showIcon message="Export échoué" description={error} />
      )}
    </Modal>
  );
}
