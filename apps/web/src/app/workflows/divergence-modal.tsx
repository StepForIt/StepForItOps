'use client';

import React from 'react';
import Link from 'next/link';
import {
  Alert,
  Button,
  Collapse,
  Descriptions,
  Modal,
  Popconfirm,
  Select,
  Skeleton,
  Space,
  Tooltip,
  Typography,
} from 'antd';
import { apiGet } from '../../lib/api';
import { DiffCounts, WorkflowDiff, WorkflowDiffView } from '../../components/workflow-diff-view';
import { PromoteModal } from './show/[id]/promote-modal';
import { usePromoteDefaults } from './show/[id]/promote-defaults';
import { useEnvLabel } from '../../lib/envs';
import { WorkflowDivergence } from './workflow-row';

interface DivergenceSide {
  id: string;
  name: string;
  env: string | null;
  instanceId: string;
  instanceName: string;
  n8nUrl: string;
  upstreamUpdatedAt: string | null;
  mirroredAt: string;
}

/** Réponse de `GET /workflows/:id/divergence`. */
interface DivergenceDetail {
  status: WorkflowDivergence['status'];
  workflow: DivergenceSide;
  reference: DivergenceSide;
  references: Array<{ id: string; name: string; instanceName: string }>;
  diff: WorkflowDiff;
}

const fr = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR') : 'date inconnue');

const METHOD =
  'Ce que la promotion bascule d’elle-même (ressources mappées, sous-workflows, paths de webhook, noms et positions) est neutralisé. Le sens vient des dates de modification dans n8n.';

/** La phrase qui fait décider : dans quel sens va l'écart, et ce que promouvoir ferait. */
function Verdict({ data }: { data: DivergenceDetail }) {
  const own = data.workflow.env ?? 'cet exemplaire';
  if (data.status === 'in-sync') {
    return <Typography.Text type="secondary">Même contenu que la prod.</Typography.Text>;
  }
  if (data.status === 'behind') {
    return (
      <Alert
        type="warning"
        showIcon
        message={`Prod modifiée après ${own}`}
        description="Promouvoir écraserait ce correctif (lignes rouges). À reporter d’abord."
      />
    );
  }
  return <Alert type="info" showIcon message={`${own} plus récent que la prod`} />;
}

function SideCell({ side }: { side: DivergenceSide }) {
  return (
    <Space direction="vertical" size={0}>
      <Typography.Text strong>{side.name}</Typography.Text>
      <Tooltip title={`Copie locale du ${fr(side.mirroredAt)}`}>
        <Typography.Text type="secondary">
          {side.instanceName} · modifié dans n8n le {fr(side.upstreamUpdatedAt)}
        </Typography.Text>
      </Tooltip>
      <Space size={12}>
        <Link href={`/workflows/show/${side.id}`}>Ouvrir la page</Link>
        <a href={side.n8nUrl} target="_blank" rel="noreferrer">
          Ouvrir dans n8n
        </a>
      </Space>
    </Space>
  );
}

/**
 * CE QUI diffère entre un exemplaire et la prod — le tag de la colonne « Écart prod »
 * ne dit que QU'il diffère, ce qui ne permet pas de décider. Le diff est celui de
 * l'empreinte elle-même : un écart constaté a toujours au moins une ligne ici.
 */
export function DivergenceModal({ workflowId, onClose }: { workflowId: string | null; onClose: () => void }) {
  const [referenceId, setReferenceId] = React.useState<string | undefined>(undefined);
  const [data, setData] = React.useState<DivergenceDetail | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [promoteOpen, setPromoteOpen] = React.useState(false);

  React.useEffect(() => {
    setData(null);
    setError(null);
    if (!workflowId) return;
    setLoading(true);
    const query = referenceId ? `?referenceId=${encodeURIComponent(referenceId)}` : '';
    apiGet<DivergenceDetail>(`/workflows/${workflowId}/divergence${query}`)
      .then(setData)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [workflowId, referenceId]);

  React.useEffect(() => {
    if (!workflowId) setReferenceId(undefined);
  }, [workflowId]);

  // La promotion vise l'étape suivante, pas la prod comparée ici : de DEV on passe
  // par PREPROD, et l'écran de promotion laisse choisir une autre cible.
  const envLabel = useEnvLabel();
  const defaults = usePromoteDefaults(data?.workflow.id, data !== null && data.status !== 'in-sync');
  const promoteLabel = defaults?.targetEnv ? `Promouvoir vers ${envLabel(defaults.targetEnv)}` : 'Promouvoir';

  const footer = data && (
    <Space>
      <Button onClick={onClose}>Fermer</Button>
      {data.status === 'behind' && (
        <>
          <Popconfirm
            title="Promouvoir malgré l’écart ?"
            description="Le correctif fait en prod sera perdu quand ce contenu y arrivera, s’il n’a pas été reporté ici."
            okText="Ouvrir la promotion"
            okButtonProps={{ danger: true }}
            onConfirm={() => setPromoteOpen(true)}
          >
            <Button danger>Promouvoir quand même</Button>
          </Popconfirm>
          <Link href={`/workflows/show/${data.reference.id}`}>
            <Button type="primary">Voir le correctif en prod</Button>
          </Link>
        </>
      )}
      {data.status === 'ahead' && (
        <Button type="primary" onClick={() => setPromoteOpen(true)}>
          {promoteLabel}
        </Button>
      )}
    </Space>
  );

  return (
    <>
      <Modal
        title={data ? `Écart avec la prod — ${data.workflow.name}` : 'Écart avec la prod'}
        open={workflowId !== null}
        onCancel={onClose}
        footer={footer ?? null}
        width={920}
        destroyOnClose
      >
        {loading && <Skeleton active />}
        {error && <Alert type="error" showIcon message={error} />}

        {data && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Verdict data={data} />

            {data.references.length > 1 && (
              <Space>
                <Typography.Text>Comparer à :</Typography.Text>
                <Select
                  style={{ minWidth: 320 }}
                  value={data.reference.id}
                  onChange={setReferenceId}
                  options={data.references.map((ref) => ({
                    value: ref.id,
                    label: `${ref.name} (${ref.instanceName})`,
                  }))}
                />
              </Space>
            )}

            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label={data.workflow.env ?? 'Exemplaire'}>
                <SideCell side={data.workflow} />
              </Descriptions.Item>
              <Descriptions.Item label="Prod">
                <SideCell side={data.reference} />
              </Descriptions.Item>
            </Descriptions>

            {data.diff.hasChanges && (
              <>
                <Typography.Text type="secondary">Avant = prod · Après = après promotion</Typography.Text>
                <DiffCounts counts={data.diff.counts} />
                <WorkflowDiffView diff={data.diff} />
              </>
            )}

            <Collapse
              size="small"
              ghost
              items={[
                {
                  key: 'method',
                  label: 'Comment l’écart est calculé',
                  children: <Typography.Paragraph type="secondary">{METHOD}</Typography.Paragraph>,
                },
              ]}
            />
          </Space>
        )}
      </Modal>

      {data && (
        <PromoteModal
          workflowId={data.workflow.id}
          sourceInstanceId={data.workflow.instanceId}
          open={promoteOpen}
          onClose={() => setPromoteOpen(false)}
        />
      )}
    </>
  );
}
