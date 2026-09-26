'use client';

import React from 'react';
import { Alert, Collapse, Empty, Space, Tag, Tooltip, Typography } from 'antd';
import { useTranslations } from 'next-intl';

/** Miroir de `RemoteTableReport` (`@nwm/core`) : le web ne dépend pas du domaine. */
export interface RemoteColumnView {
  name: string;
  access: 'read' | 'write';
  nodeName: string;
  via?: string;
  severity: 'error' | 'warning';
  present: boolean | null;
  suggestion?: string;
}

export interface RemoteTableView {
  key: string;
  provider: string;
  label?: string;
  nodes: string[];
  status: 'ok' | 'issues' | 'missing' | 'unverified';
  reason?: string;
  columns: RemoteColumnView[];
  partial: Array<{ nodeName: string; reason: string }>;
}

export interface UnlocatableView {
  nodeName: string;
  provider: string;
  reason: string;
}

const PROVIDER_LABEL: Record<string, string> = {
  airtable: 'Airtable',
  nocodb: 'NocoDB',
  notion: 'Notion',
  'google-sheets': 'Google Sheets',
  postgres: 'PostgreSQL',
};

const STATUS_COLOR: Record<RemoteTableView['status'], string> = {
  ok: 'green',
  issues: 'red',
  missing: 'red',
  unverified: 'default',
};

function ColumnLine({ column }: { column: RemoteColumnView }) {
  const t = useTranslations('reviewTools.remoteSchema');
  const color =
    column.present === null
      ? 'default'
      : column.present
        ? 'green'
        : column.severity === 'error'
          ? 'red'
          : 'orange';
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', padding: '2px 0' }}>
      <Tag color={color} style={{ marginInlineEnd: 0 }}>
        {column.name}
      </Tag>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {column.access === 'write'
          ? t('columnWritten', { node: column.nodeName })
          : t('columnRead', { node: column.nodeName })}
        {column.via ? t('columnVia', { set: column.via }) : ''}
      </Typography.Text>
      {column.present === false && column.suggestion && (
        <Typography.Text style={{ fontSize: 12 }}>
          {t('closeColumn', { column: column.suggestion })}
        </Typography.Text>
      )}
      {column.present === false && column.severity === 'warning' && (
        <Typography.Text type="warning" style={{ fontSize: 12 }}>
          {t('ignoredOnWrite')}
        </Typography.Text>
      )}
    </div>
  );
}

/**
 * Tables distantes d'un workflow : une ligne par table, dépliée d'office quand
 * quelque chose y manque. Une table non lue le dit avec sa raison — jamais
 * affichée comme complète.
 */
export function RemoteSchemaTables({
  tables,
  unlocatable = [],
}: {
  tables: RemoteTableView[];
  unlocatable?: UnlocatableView[];
}) {
  const t = useTranslations('reviewTools.remoteSchema');
  if (tables.length === 0 && unlocatable.length === 0) {
    return <Empty description={t('noTable')} />;
  }
  const opened = tables
    .filter((table) => table.status === 'issues' || table.status === 'missing')
    .map((table) => table.key);

  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      <Collapse
        size="small"
        defaultActiveKey={opened}
        items={tables.map((table) => ({
          key: table.key,
          label: (
            <Space wrap>
              <Tag>{PROVIDER_LABEL[table.provider] ?? table.provider}</Tag>
              <Typography.Text strong>{table.label ?? table.key}</Typography.Text>
              <Tag color={STATUS_COLOR[table.status]}>{t(`status.${table.status}`)}</Tag>
              {table.partial.length > 0 && (
                <Tooltip title={table.partial.map((item) => `${item.nodeName} — ${item.reason}`).join(' · ')}>
                  <Tag color="gold">{t('partlyVerifiable')}</Tag>
                </Tooltip>
              )}
            </Space>
          ),
          children: (
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              {table.status === 'unverified' && (
                <Alert
                  type="warning"
                  showIcon
                  message={t('unverified', { reason: table.reason ?? t('unknownReason') })}
                />
              )}
              {table.columns.length === 0 && (
                <Typography.Text type="secondary">{t('noExpectedColumn')}</Typography.Text>
              )}
              {table.columns.map((column) => (
                <ColumnLine key={`${column.nodeName}/${column.name}`} column={column} />
              ))}
              {table.partial.map((item) => (
                <Typography.Text
                  key={`${item.nodeName}/${item.reason}`}
                  type="secondary"
                  style={{ fontSize: 12 }}
                >
                  {t('partialColumns', { node: item.nodeName, reason: item.reason })}
                </Typography.Text>
              ))}
            </Space>
          ),
        }))}
      />
      {unlocatable.length > 0 && (
        <Alert
          type="info"
          showIcon
          message={t('unlocatable', { count: unlocatable.length })}
          description={unlocatable
            .map((node) => t('nodeReason', { node: node.nodeName, reason: node.reason }))
            .join(' · ')}
        />
      )}
    </Space>
  );
}
