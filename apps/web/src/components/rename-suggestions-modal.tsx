'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Segmented, Space, Tag, Tooltip, message } from 'antd';
import { useTranslations } from 'next-intl';
import { Table } from './resizable-table';
import { apiGet, apiPost } from '../lib/api';
import { AiSettings, AiSettingsModal } from './ai-settings-modal';

interface RenameSuggestion {
  /** Make : l'id du module. Deux modules sans nom y portent le même libellé, l'id seul dit lequel. */
  moduleId?: number;
  oldName: string;
  newName: string;
  /** Description FR verbeuse, posée en note sur le nœud (non affichée sur le canvas). */
  note?: string;
  reason: string;
}

interface Props {
  workflowId: string;
  open: boolean;
  onClose: () => void;
  /** Appelé après application des renommages (pour relancer l'analyse / recharger les findings). */
  onApplied: () => void;
}

const keyOf = (suggestion: RenameSuggestion): React.Key => suggestion.moduleId ?? suggestion.oldName;

/**
 * Modal « Suggérer des noms » : propositions IA éditables, puis renommage sûr via
 * l'optimizer. Sert n8n et Make ; une suggestion Make se reconnaît à son `moduleId`.
 */
export function RenameSuggestionsModal({ workflowId, open, onClose, onApplied }: Props) {
  const t = useTranslations('reviewTools.renameSuggestions');
  const [suggestions, setSuggestions] = useState<RenameSuggestion[]>([]);
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [aiSource, setAiSource] = useState<AiSettings['source'] | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [language, setLanguage] = useState<'en' | 'fr'>('en');
  const [wholeWorkflow, setWholeWorkflow] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setSuggestions([]);
    apiGet<AiSettings>('/settings/ai')
      .then(async (settings) => {
        setAiSource(settings.source);
        if (settings.source === 'none') return; // pas de clé : on propose la config, pas d'appel inutile
        const result = await apiPost<RenameSuggestion[]>(`/optimizer/suggest-names/${workflowId}`, {
          language,
          scope: wholeWorkflow ? 'all' : 'default-names',
        });
        setSuggestions(result);
        setSelected(result.map(keyOf));
      })
      .catch((error) => message.error((error as Error).message))
      .finally(() => setLoading(false));
  }, [workflowId, language, wholeWorkflow]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const isMake = suggestions.some((s) => s.moduleId !== undefined);

  const apply = async () => {
    const renames = suggestions
      .filter((s) => selected.includes(keyOf(s)) && s.newName.trim() && s.newName !== s.oldName)
      .map(({ moduleId, oldName, newName, note }) => ({
        moduleId,
        oldName,
        newName: newName.trim(),
        note: note?.trim() || undefined,
      }));
    if (renames.length === 0) {
      message.info(t('noneSelected'));
      return;
    }
    setApplying(true);
    try {
      const result = await apiPost<{ renamed: number }>(`/optimizer/apply-renames/${workflowId}`, {
        renames,
      });
      message.success(
        isMake ? t('renamedMake', { count: result.renamed }) : t('renamedN8n', { count: result.renamed }),
      );
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
      okButtonProps={{ disabled: suggestions.length === 0, loading: applying }}
      onOk={apply}
    >
      <Space style={{ marginBottom: 12 }} wrap>
        <Segmented
          value={language}
          onChange={(value) => setLanguage(value as 'en' | 'fr')}
          disabled={loading}
          options={[
            { label: t('english'), value: 'en' },
            { label: t('french'), value: 'fr' },
          ]}
        />
        <Checkbox
          checked={wholeWorkflow}
          disabled={loading}
          onChange={(e) => setWholeWorkflow(e.target.checked)}
        >
          {t('wholeWorkflow')}
        </Checkbox>
      </Space>
      {aiSource === 'none' && (
        <Alert
          type="warning"
          showIcon
          message={t('aiNotConfigured')}
          action={
            <Button type="primary" onClick={() => setAiModalOpen(true)}>
              {t('configureAi')}
            </Button>
          }
        />
      )}
      {aiSource !== null && aiSource !== 'none' && !loading && suggestions.length === 0 && (
        <Alert
          type="info"
          message={t('noSuggestion')}
          description={wholeWorkflow ? t('alreadyConsistent') : t('noDefaultName')}
        />
      )}
      {(loading || suggestions.length > 0) && (
        <Table
          dataSource={suggestions}
          rowKey={keyOf}
          size="small"
          loading={loading}
          pagination={false}
          rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
        >
          <Table.Column<RenameSuggestion>
            dataIndex="oldName"
            title={t('currentName')}
            render={(name: string, record) => (
              <Tag>
                {name}
                {record.moduleId !== undefined ? ` #${record.moduleId}` : ''}
              </Tag>
            )}
          />
          <Table.Column<RenameSuggestion>
            dataIndex="newName"
            title={t('newName')}
            render={(newName: string, record) => (
              <Tooltip title={record.reason}>
                <Input
                  value={newName}
                  onChange={(e) =>
                    setSuggestions((all) =>
                      all.map((s) => (keyOf(s) === keyOf(record) ? { ...s, newName: e.target.value } : s)),
                    )
                  }
                />
              </Tooltip>
            )}
          />
          {!isMake && (
            <Table.Column<RenameSuggestion>
              dataIndex="note"
              title={t('noteColumn')}
              render={(note: string | undefined, record) => (
                <Input.TextArea
                  value={note}
                  autoSize={{ minRows: 1, maxRows: 4 }}
                  placeholder={t('notePlaceholder')}
                  onChange={(e) =>
                    setSuggestions((all) =>
                      all.map((s) => (keyOf(s) === keyOf(record) ? { ...s, note: e.target.value } : s)),
                    )
                  }
                />
              )}
            />
          )}
        </Table>
      )}
      <AiSettingsModal open={aiModalOpen} onClose={() => setAiModalOpen(false)} onChanged={load} />
    </Modal>
  );
}
