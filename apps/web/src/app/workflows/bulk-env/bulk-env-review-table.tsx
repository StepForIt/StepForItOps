'use client';

import React from 'react';
import { Table, Tag, Tooltip, Typography } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useInstanceScope } from '../../../lib/instance-scope';
import { versionForLevel } from '../show/[id]/promote-version-card';
import { BulkEnvRowDetail } from './bulk-env-row-detail';
import { STATUS_TAG, rowStatus } from './row-status';
import { ReviewRow, RowChoices } from './types';

/** Le nom de l'exemplaire n'apprend rien quand il n'ajoute au nom métier que son suffixe d'env. */
function repeatsFamily(sourceName: string, familyName: string): boolean {
  return sourceName.trim().toLowerCase().startsWith(familyName.trim().toLowerCase());
}

/**
 * Une ligne par workflow métier : son statut, où il va, et ce qu'il est devenu.
 * Les lignes à décider et bloquées se déplient sur leur détail, sans quitter le
 * lot — c'était tout l'intérêt : ne regarder que ce qui demande un regard.
 */
export function BulkEnvReviewTable({
  rows,
  onChoices,
  onRefresh,
  locked,
}: {
  rows: ReviewRow[];
  onChoices: (familyKey: string, choices: Partial<RowChoices>) => void;
  onRefresh: (row: ReviewRow) => void;
  locked: boolean;
}) {
  const { instanceName } = useInstanceScope();

  return (
    <Table<ReviewRow>
      dataSource={rows}
      rowKey={(row) => row.plan.familyKey}
      pagination={false}
      size="small"
      tableLayout="fixed"
      expandable={{
        expandedRowRender: (row) => (
          <BulkEnvRowDetail
            row={row}
            // Une ligne déjà écrite ne se redécide plus : ce serait décider d'un geste passé.
            locked={locked || row.outcome.state === 'done'}
            onChoices={(choices) => onChoices(row.plan.familyKey, choices)}
            onRefresh={() => onRefresh(row)}
          />
        ),
        rowExpandable: (row) => rowStatus(row) !== 'loading',
      }}
    >
      <Table.Column<ReviewRow>
        title="Workflow"
        width={220}
        render={(_, row) => (
          <>
            <Typography.Text strong>{row.plan.familyName}</Typography.Text>
            {row.plan.status === 'planned' && !repeatsFamily(row.plan.sourceName, row.plan.familyName) && (
              <div>
                <Typography.Text type="secondary">{row.plan.sourceName}</Typography.Text>
              </div>
            )}
          </>
        )}
      />
      <Table.Column<ReviewRow>
        title="Statut"
        width={110}
        render={(_, row) => {
          const status = rowStatus(row);
          const validated = status === 'ready' && row.choices.validated;
          return (
            <Tag color={STATUS_TAG[status].color}>{validated ? 'validée' : STATUS_TAG[status].label}</Tag>
          );
        }}
      />
      <Table.Column<ReviewRow>
        title="Cible"
        width={200}
        render={(_, row) =>
          row.plan.status === 'skipped' ? (
            <Typography.Text type="secondary">—</Typography.Text>
          ) : (
            <>
              <Tag>{row.plan.targetEnv.toUpperCase()}</Tag>
              <Tag color="geekblue">{instanceName(row.plan.targetInstanceId)}</Tag>
              {row.preview?.kind === 'promote' && (
                <Typography.Text type="secondary">
                  {row.preview.data.mode === 'update' ? 'écrase' : 'crée'} ·{' '}
                  {versionForLevel(
                    row.preview.data.gates.version,
                    row.choices.bump ?? row.preview.data.gates.version.level,
                  )}
                </Typography.Text>
              )}
            </>
          )
        }
      />
      <Table.Column<ReviewRow>
        title="À faire"
        render={(_, row) => {
          if (row.plan.status === 'skipped') {
            return <Typography.Text type="secondary">{row.plan.reason}</Typography.Text>;
          }
          if (row.preview?.kind === 'mark') {
            return <Typography.Text type="secondary">{row.preview.data.changes.join(' · ')}</Typography.Text>;
          }
          const readiness = row.preview?.data.readiness;
          if (!readiness) return null;
          if (readiness.status === 'blocked')
            return <Typography.Text type="danger">{readiness.reasons[0]}</Typography.Text>;
          return readiness.decisions.map((decision) => (
            <Tag key={decision.code} color="orange" style={{ whiteSpace: 'normal', marginBottom: 4 }}>
              {decision.label}
            </Tag>
          ));
        }}
      />
      <Table.Column<ReviewRow>
        title="Résultat"
        width={280}
        render={(_, row) => {
          switch (row.outcome.state) {
            case 'running':
              return <LoadingOutlined />;
            case 'done':
              return (
                <span>
                  <CheckCircleOutlined style={{ color: 'var(--ant-color-success, #52c41a)' }} />{' '}
                  {row.outcome.detail ? (
                    <Tooltip title={row.outcome.detail}>{row.outcome.summary}</Tooltip>
                  ) : (
                    row.outcome.summary
                  )}
                  {row.outcome.warning && (
                    <Tooltip title={row.outcome.warning}>
                      {' '}
                      <WarningOutlined style={{ color: 'var(--ant-color-warning, #faad14)' }} />
                    </Tooltip>
                  )}
                </span>
              );
            case 'failed':
              return (
                <Typography.Text type="danger">
                  <CloseCircleOutlined /> {row.outcome.error}
                </Typography.Text>
              );
            default:
              return null;
          }
        }}
      />
    </Table>
  );
}
