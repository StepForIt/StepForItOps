'use client';

import React from 'react';
import { Alert, Button, Checkbox, Space, Tag, Typography } from 'antd';
import { CheckOutlined, ReloadOutlined } from '@ant-design/icons';
import { SwitchedResources } from '../../../components/switched-resources';
import { WorkflowDiffView } from '../../../components/workflow-diff-view';
import { PromoteVersionCard } from '../show/[id]/promote-version-card';
import { missingChecks } from './row-status';
import { PromotePreview, ReviewRow, RowChoices } from './types';

/**
 * Le détail d'une ligne, déplié dans la revue du lot : ce qu'il faut regarder
 * avant de la laisser partir, et les cases que ses décisions exigent. `force` et
 * `confirmSkip` restent deux cases distinctes, comme sur la page d'un workflow —
 * confondre les deux ferait passer un saut d'étape à qui voulait forcer un test rouge.
 */
export function BulkEnvRowDetail({
  row,
  onChoices,
  onRefresh,
  locked,
}: {
  row: ReviewRow;
  onChoices: (choices: Partial<RowChoices>) => void;
  onRefresh: () => void;
  /** Un lot est en cours d'écriture : on ne change pas une décision sous ses pieds. */
  locked: boolean;
}) {
  if (row.plan.status === 'skipped')
    return <Typography.Text type="secondary">{row.plan.reason}</Typography.Text>;
  if (row.previewError) {
    return (
      <Space direction="vertical">
        <Alert type="error" showIcon message="L’aperçu a échoué" description={row.previewError} />
        <Button size="small" icon={<ReloadOutlined />} onClick={onRefresh} disabled={locked}>
          Relancer l’aperçu
        </Button>
      </Space>
    );
  }
  if (!row.preview) return <Typography.Text type="secondary">Aperçu en cours…</Typography.Text>;

  const { readiness } = row.preview.data;
  const codes = readiness.decisions.map((decision) => decision.code);
  const missing = missingChecks(row);

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {readiness.status === 'blocked' && (
        <Alert type="error" showIcon message={`Bloquée : ${readiness.reasons.join(' ; ')}`} />
      )}

      {/* Les décisions sont déjà en tag dans la colonne « À faire » : seul leur détail s'ajoute ici. */}
      {readiness.decisions
        .filter((decision) => decision.details?.length)
        .map((decision) => (
          <div key={decision.code}>
            <Typography.Text type="secondary" strong>
              {decision.label}
            </Typography.Text>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {decision.details?.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          </div>
        ))}

      {row.preview.kind === 'promote' && (
        <PromoteDetail
          preview={row.preview.data}
          choices={row.choices}
          onChoices={onChoices}
          locked={locked}
        />
      )}
      {row.preview.kind === 'duplicate' && (
        <div>
          <Typography.Text>Copie « {row.preview.data.targetName} »</Typography.Text>
          <SwitchedResources
            switched={row.preview.data.switched}
            replacements={row.preview.data.replacements}
          />
        </div>
      )}

      {readiness.status === 'decide' && (
        <Space wrap>
          {codes.includes('force') && (
            <Checkbox
              checked={row.choices.force}
              disabled={locked}
              onChange={(e) => onChoices({ force: e.target.checked, validated: false })}
            >
              Forcer malgré les gates au rouge
            </Checkbox>
          )}
          {codes.includes('confirm-skip') && (
            <Checkbox
              checked={row.choices.confirmSkip}
              disabled={locked}
              onChange={(e) => onChoices({ confirmSkip: e.target.checked, validated: false })}
            >
              Sauter l’étape quand même
            </Checkbox>
          )}
          {row.choices.validated ? (
            <Button size="small" onClick={() => onChoices({ validated: false })} disabled={locked}>
              Revenir sur la validation
            </Button>
          ) : (
            <Button
              size="small"
              type="primary"
              icon={<CheckOutlined />}
              disabled={missing.length > 0 || locked}
              title={missing.length > 0 ? `D’abord : ${missing.join(', ')}` : undefined}
              onClick={() => onChoices({ validated: true })}
            >
              Valider cette ligne
            </Button>
          )}
          <Button size="small" icon={<ReloadOutlined />} onClick={onRefresh} disabled={locked}>
            Relancer l’aperçu
          </Button>
        </Space>
      )}
    </Space>
  );
}

function PromoteDetail({
  preview,
  choices,
  onChoices,
  locked,
}: {
  preview: PromotePreview;
  choices: RowChoices;
  onChoices: (choices: Partial<RowChoices>) => void;
  locked: boolean;
}) {
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Typography.Text>
        {preview.mode === 'update' ? 'Écrase' : 'Crée'} « {preview.targetName} » sur{' '}
        {preview.targetInstanceName}
        {preview.targetActive && (
          <Tag color="red" style={{ marginLeft: 8 }}>
            cible active
          </Tag>
        )}
      </Typography.Text>
      {preview.cascade.length > 0 && (
        <Typography.Text type="secondary">
          Créés d’abord : {preview.cascade.map((item) => item.targetName).join(', ')}
        </Typography.Text>
      )}
      <div style={{ pointerEvents: locked ? 'none' : undefined }}>
        <PromoteVersionCard
          gate={preview.gates.version}
          level={choices.bump ?? preview.gates.version.level}
          onLevel={(bump) => onChoices({ bump })}
        />
      </div>
      {preview.diff?.hasChanges && <WorkflowDiffView diff={preview.diff} maxHeight={320} />}
    </Space>
  );
}
