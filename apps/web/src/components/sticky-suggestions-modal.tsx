'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Input, Modal, Space, Tag, Tooltip, message } from 'antd';
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
      message.info('Aucune sticky sélectionnée');
      return;
    }
    setApplying(true);
    try {
      const result = await apiPost<{ applied: number }>(`/optimizer/apply-stickies/${workflowId}`, {
        stickies,
      });
      message.success(`${result.applied} sticky(ies) créée(s) ou complétée(s)`);
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
      title="Documenter les zones (sticky notes)"
      open={open}
      onCancel={onClose}
      width={800}
      okText={`Appliquer (${selected.length})`}
      okButtonProps={{ disabled: rows.length === 0, loading: applying }}
      onOk={apply}
    >
      {aiSource === 'none' && (
        <Alert
          type="warning"
          showIcon
          message="IA non configurée"
          action={
            <Button type="primary" onClick={() => setAiModalOpen(true)}>
              Configurer l'IA
            </Button>
          }
        />
      )}
      {aiSource !== null && aiSource !== 'none' && !loading && rows.length === 0 && (
        <Alert
          type="info"
          message="Aucune suggestion"
          description="Toutes les zones sont documentées et tous les nœuds sont couverts."
        />
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
            title="Action"
            render={(action: Row['action']) =>
              action === 'create' ? <Tag color="green">Créer</Tag> : <Tag color="blue">Compléter</Tag>
            }
          />
          <Table.Column<Row>
            title="Zone"
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
            title="Contenu"
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
