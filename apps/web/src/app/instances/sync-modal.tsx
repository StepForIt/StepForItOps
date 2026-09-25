'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Button, List, Modal, Typography } from 'antd';
import {
  CloudDownloadOutlined,
  DatabaseOutlined,
  HistoryOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { apiPost } from '../../lib/api';

interface SyncResult {
  synced: number;
  changed: number;
}

const STEPS = [
  {
    icon: <CloudDownloadOutlined />,
    title: 'Lecture des workflows sur n8n',
    detail: "Un simple GET /workflows sur l'API n8n de l'instance, page par page.",
  },
  {
    icon: <DatabaseOutlined />,
    title: 'Mise à jour du miroir local',
    detail:
      'Nom, statut actif, tags et JSON du workflow sont enregistrés dans la base de la plateforme. Les workflows déjà connus sont mis à jour, les nouveaux sont ajoutés.',
  },
  {
    icon: <HistoryOutlined />,
    title: 'Nouvelle version pour les workflows modifiés',
    detail:
      "Si le contenu a changé depuis la dernière synchro, le module versioning crée une version. Si une cible d'export (GitHub / Google Drive) est activée, cette version y est aussi poussée.",
  },
];

/** Explique ce que fait la synchro avant de la lancer, puis affiche le résultat. */
export function SyncModal({
  instanceId,
  instanceName,
  onClose,
}: {
  instanceId: string | null;
  instanceName?: string;
  onClose: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setError(null);
  }, [instanceId]);

  const run = async () => {
    if (!instanceId) return;
    setRunning(true);
    setError(null);
    try {
      setResult(await apiPost<SyncResult>(`/workflows/sync/${instanceId}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal
      title={`Synchroniser — ${instanceName ?? ''}`}
      open={instanceId !== null}
      onCancel={onClose}
      width={640}
      footer={
        result ? (
          <Button type="primary" onClick={onClose}>
            Fermer
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Annuler</Button>
            <Button type="primary" loading={running} onClick={run}>
              Synchroniser
            </Button>
          </>
        )
      }
    >
      <Alert
        type="success"
        showIcon
        icon={<SafetyCertificateOutlined />}
        message="Rien n'est modifié dans n8n"
        description="La synchronisation lit l'API n8n en lecture seule : aucun workflow n'est créé, modifié, activé, désactivé ni exécuté sur l'instance."
        style={{ marginBottom: 16 }}
      />

      <Typography.Text strong>Ce qui se passe côté plateforme</Typography.Text>
      <List
        size="small"
        dataSource={STEPS}
        renderItem={(step) => (
          <List.Item>
            <List.Item.Meta
              avatar={<span style={{ fontSize: 18, color: '#1677ff' }}>{step.icon}</span>}
              title={step.title}
              description={
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {step.detail}
                </Typography.Text>
              }
            />
          </List.Item>
        )}
      />

      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12 }}>
        À noter : le graphe de dépendances et la carte des workflows ne se mettent pas à jour tout seuls —
        reconstruis le graphe depuis la page Dépendances après une synchro.
      </Typography.Paragraph>

      {error && <Alert type="error" showIcon message="Synchronisation échouée" description={error} />}
      {result && (
        <Alert
          type="success"
          showIcon
          message={`${result.synced} workflows synchronisés`}
          description={
            result.changed > 0
              ? `${result.changed} ont changé depuis la dernière synchro : une nouvelle version a été créée pour chacun.`
              : 'Aucun changement détecté : aucune nouvelle version créée.'
          }
        />
      )}
    </Modal>
  );
}
