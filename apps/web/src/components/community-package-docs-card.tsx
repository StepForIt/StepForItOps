'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Form, Input, Modal, Popconfirm, Space, Tooltip, Typography, message } from 'antd';
import { CloudDownloadOutlined, EditOutlined, EyeOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { ResponsiveCard } from './mobile/responsive-card';
import { Table } from './resizable-table';
import { Markdown } from './markdown';
import { apiDelete, apiGet, apiPost, apiPut } from '../lib/api';

interface DocSummary {
  kind: 'auto' | 'manual';
  source: string;
  version?: string;
  url?: string;
  chars: number;
  fetchedAt: string;
  updatedBy?: string;
}

interface PackageRow {
  packageName: string;
  versions: string[];
  nodeTypes: string[];
  instances: number;
  docs: DocSummary[];
}

const q = (name: string) => encodeURIComponent(name);

/**
 * Le mode d'emploi des nœuds communautaires, tel que l'assistant IA le lit.
 *
 * Le README vient tout seul du registre npm ; la doc de l'équipe est ce qu'on y
 * ajoute à la main — une page de doc externe, les pièges connus. Les deux sont
 * servis ensemble : l'une ne remplace pas l'autre.
 */
export function CommunityPackageDocsCard() {
  const t = useTranslations('settings.communityDocs');
  const [rows, setRows] = useState<PackageRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ title: string; content: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<PackageRow[]>('/node-catalog/packages')
      .then(setRows)
      .catch((error) => message.error((error as Error).message));
  }, []);
  useEffect(load, [load]);

  const refresh = async (packageName?: string) => {
    setBusy(packageName ?? 'all');
    try {
      const counts = await apiPost<Record<string, number>>(
        '/node-catalog/packages/refresh',
        packageName ? { packageName } : {},
      );
      message.success(
        counts.fetched
          ? t('fetched', { count: counts.fetched })
          : counts.failed
            ? t('failed')
            : t('noneFound'),
      );
      load();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const view = async (row: PackageRow, doc: DocSummary) => {
    try {
      const { content } = await apiGet<{ content: string }>(
        `/node-catalog/packages/doc?name=${q(row.packageName)}&kind=${doc.kind}`,
      );
      setViewing({
        title:
          doc.kind === 'manual'
            ? t('teamDocTitle', { name: row.packageName })
            : t('readmeTitle', { name: row.packageName }),
        content,
      });
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  if (rows && rows.length === 0) return null;

  return (
    <ResponsiveCard
      size="small"
      title={t('title')}
      style={{ marginBottom: 16 }}
      extra={
        <Tooltip title={t('refreshAllTooltip')}>
          <Button
            size="small"
            icon={<CloudDownloadOutlined />}
            loading={busy === 'all'}
            onClick={() => refresh()}
          >
            {t('refreshAll')}
          </Button>
        </Tooltip>
      }
    >
      <Table
        size="small"
        rowKey="packageName"
        pagination={false}
        loading={rows === null}
        dataSource={rows ?? []}
        columns={[
          {
            title: t('columns.package'),
            dataIndex: 'packageName',
            render: (name: string, row: PackageRow) => (
              <Tooltip title={row.nodeTypes.join(', ') || t('unused')}>
                <Typography.Text>{name}</Typography.Text>
              </Tooltip>
            ),
          },
          {
            title: t('columns.installed'),
            dataIndex: 'versions',
            render: (versions: string[]) => (versions.length ? versions.join(', ') : '—'),
          },
          {
            title: t('columns.readme'),
            key: 'auto',
            render: (_: unknown, row: PackageRow) => {
              const doc = row.docs.find((entry) => entry.kind === 'auto');
              if (!doc) return <Typography.Text type="secondary">{t('noReadme')}</Typography.Text>;
              return (
                <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => view(row, doc)}>
                  {doc.source} {doc.version ?? ''}
                </Button>
              );
            },
          },
          {
            title: t('columns.teamDoc'),
            key: 'manual',
            render: (_: unknown, row: PackageRow) => {
              const doc = row.docs.find((entry) => entry.kind === 'manual');
              return doc ? (
                <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => view(row, doc)}>
                  {t('size', { kb: Math.max(1, Math.round(doc.chars / 1000)) })}
                </Button>
              ) : (
                <Typography.Text type="secondary">—</Typography.Text>
              );
            },
          },
          {
            title: '',
            key: 'actions',
            render: (_: unknown, row: PackageRow) => (
              <Space size="small">
                <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(row.packageName)}>
                  {t('columns.teamDoc')}
                </Button>
                <Button
                  size="small"
                  loading={busy === row.packageName}
                  onClick={() => refresh(row.packageName)}
                >
                  {t('refresh')}
                </Button>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        open={viewing !== null}
        title={viewing?.title}
        footer={null}
        width={820}
        onCancel={() => setViewing(null)}
      >
        {viewing && <Markdown content={viewing.content} />}
      </Modal>

      {editing && (
        <ManualDocModal
          packageName={editing}
          onClose={(saved) => {
            setEditing(null);
            if (saved) load();
          }}
        />
      )}
    </ResponsiveCard>
  );
}

/** Saisie de la doc de l'équipe : un texte collé, ou une adresse lue une fois par l'api. */
function ManualDocModal({
  packageName,
  onClose,
}: {
  packageName: string;
  onClose: (saved: boolean) => void;
}) {
  const t = useTranslations('settings.communityDocs');
  const tc = useTranslations('common');
  const [form] = Form.useForm<{ text?: string; url?: string }>();
  const [exists, setExists] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiGet<{ content: string }>(`/node-catalog/packages/doc?name=${q(packageName)}&kind=manual`)
      .then(({ content }) => {
        setExists(true);
        form.setFieldsValue({ text: content });
      })
      .catch(() => setExists(false));
  }, [form, packageName]);

  const save = async () => {
    const values = form.getFieldsValue();
    setSaving(true);
    try {
      await apiPut('/node-catalog/packages/doc', { packageName, text: values.text, url: values.url });
      message.success(t('saved'));
      onClose(true);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await apiDelete(`/node-catalog/packages/doc?name=${q(packageName)}`);
      message.success(t('removed'));
      onClose(true);
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  return (
    <Modal
      open
      title={t('teamDocTitle', { name: packageName })}
      width={720}
      onCancel={() => onClose(false)}
      footer={
        <Space>
          {exists && (
            <Popconfirm title={t('removeConfirm')} onConfirm={remove}>
              <Button danger>{t('remove')}</Button>
            </Popconfirm>
          )}
          <Button onClick={() => onClose(false)}>{tc('cancel')}</Button>
          <Button type="primary" loading={saving} onClick={save}>
            {tc('save')}
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item name="url" label={t('urlLabel')} extra={t('urlHint')}>
          <Input placeholder="https://…" inputMode="url" />
        </Form.Item>
        <Form.Item name="text" label={t('textLabel')} extra={t('textHint')}>
          <Input.TextArea autoSize={{ minRows: 8, maxRows: 20 }} placeholder={t('textPlaceholder')} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
