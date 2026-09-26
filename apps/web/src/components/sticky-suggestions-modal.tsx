'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Input, Modal, Space, Tag, Tooltip, message } from 'antd';
import { useTranslations } from 'next-intl';
import { Table } from './resizable-table';
import { apiGet, apiPost } from '../lib/api';
import { AiSettings, AiSettingsModal } from './ai-settings-modal';

interface StickySuggestion {
  action: 'create' | 'update';
  /** Sticky existante à compléter (update). */
  stickyName?: string;
  content: string;
  color?: number;
  /** Nœuds que la nouvelle zone doit couvrir (create). */
  nodeNames?: string[];
  reason: string;
}

/** Suggestion avec clé de ligne stable (les créations n'ont pas de stickyName). */
type Row = StickySuggestion & { key: string };

interface Props {
  workflowId: string;
  open: boolean;
  onClose: () => void;
  /** Appelé après application (pour relancer l'analyse / recharger les findings). */
  onApplied: () => void;
}

/** Modal « Documenter les zones » : stickies proposées par l'IA, éditables, puis PUT via l'optimizer. */
export function StickySuggestionsModal({ workflowId, open, onClose, onApplied }: Props) {
  const t = useTranslations('reviewTools.stickySuggestions');
  const tAi = useTranslations('reviewTools.renameSuggestions');
  const tCommon = useTranslations('common');
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [aiSource, setAiSource] = useState<AiSettings['source'] | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setRows([]);
    apiGet<AiSettings>('/settings/ai')
      .then(async (settings) => {
        setAiSource(settings.source);
        if (settings.source === 'none') return; // pas de clé : on propose la config, pas d'appel inutile
        const result = await apiPost<StickySuggestion[]>(`/optimizer/suggest-stickies/${workflowId}`);
        const withKeys = result.map((s, index) => ({ ...s, key: s.stickyName ?? `new-${index}` }));
        setRows(withKeys);
        setSelected(withKeys.map((s) => s.key));
      })
      .catch((error) => message.error((error as Error).message))
      .finally(() => setLoading(false));
  }, [workflowId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const apply = async () => {
    const stickies = rows
      .filter((s) => selected.includes(s.key) && s.content.trim())
      .map(({ action, stickyName, content, color, nodeNames }) => ({
        action,
        stickyName,
        content: content.trim(),
        color,
        nodeNames,
      }));
    if (stickies.length === 0) {
      message.info(t('noneSelected'));
      return;
    }
    setApplying(true);
    try {
      const result = await apiPost<{ applied: number }>(`/optimizer/apply-stickies/${workflowId}`, {
        stickies,
      });
      message.success(t('applied', { count: result.applied }));
      onClose();
      onApplied();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal
      title={t('title')}
      open={open}
      onCancel={onClose}
      width={800}
      okText={t('ok', { count: selected.length })}
      okButtonProps={{ disabled: rows.length === 0, loading: applying }}
      onOk={apply}
    >
      {aiSource === 'none' && (
        <Alert
          type="warning"
          showIcon
          message={tAi('aiNotConfigured')}
          action={
            <Button type="primary" onClick={() => setAiModalOpen(true)}>
              {tAi('configureAi')}
            </Button>
          }
        />
      )}
      {aiSource !== null && aiSource !== 'none' && !loading && rows.length === 0 && (
        <Alert type="info" message={tAi('noSuggestion')} description={t('allDocumented')} />
      )}
      {(loading || rows.length > 0) && (
        <Table
          dataSource={rows}
          rowKey="key"
          size="small"
          loading={loading}
          pagination={false}
          rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
        >
          <Table.Column<Row>
            dataIndex="action"
            title={t('action')}
            render={(action: Row['action']) =>
              action === 'create' ? (
                <Tag color="green">{tCommon('create')}</Tag>
              ) : (
                <Tag color="blue">{t('complete')}</Tag>
              )
            }
          />
          <Table.Column<Row>
            title={t('zone')}
            render={(_, record) =>
              record.action === 'update' ? (
                <Tag>{record.stickyName}</Tag>
              ) : (
                <Space size={4} wrap>
                  {(record.nodeNames ?? []).map((name) => (
                    <Tag key={name}>{name}</Tag>
                  ))}
                </Space>
              )
            }
          />
          <Table.Column<Row>
            dataIndex="content"
            title={t('content')}
            width="50%"
            render={(content: string, record) => (
              <Tooltip title={record.reason}>
                <Input.TextArea
                  value={content}
                  autoSize={{ minRows: 2, maxRows: 6 }}
                  onChange={(e) =>
                    setRows((all) =>
                      all.map((s) => (s.key === record.key ? { ...s, content: e.target.value } : s)),
                    )
                  }
                />
              </Tooltip>
            )}
          />
        </Table>
      )}
      <AiSettingsModal open={aiModalOpen} onClose={() => setAiModalOpen(false)} onChanged={load} />
    </Modal>
  );
}
