'use client';

import React from 'react';
import { Button, Collapse, Input, Popconfirm, Space, Tooltip, Typography, message } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { apiDelete, apiGet, apiPost } from '../lib/api';

interface MemoryFact {
  id: string;
  content: string;
  createdAt: string;
}

/**
 * Ce que l'assistant garde de ce workflow, d'une conversation à l'autre.
 *
 * Visible et corrigeable, faute de quoi la mémoire serait un passif : un fait
 * faux se répéterait à chaque conversation sans qu'on sache d'où il sort, et
 * l'assistant paraîtrait s'entêter alors qu'il applique ce qu'on lui a dit.
 * Repliée par défaut — on l'ouvre quand une réponse surprend.
 */
export function ChatMemory({ workflowId }: { workflowId: string }) {
  const t = useTranslations('chat.memory');
  const tCommon = useTranslations('common');
  const [facts, setFacts] = React.useState<MemoryFact[]>([]);
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const reload = React.useCallback(async () => {
    try {
      setFacts(await apiGet<MemoryFact[]>(`/workflow-chat/workflows/${workflowId}/memory`));
    } catch {
      // La mémoire est un confort : son indisponibilité ne doit pas masquer le chat.
      setFacts([]);
    }
  }, [workflowId]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const add = async () => {
    const content = draft.trim();
    if (!content) return;
    setBusy(true);
    try {
      const result = await apiPost<{ stored: boolean; reason?: string }>(
        `/workflow-chat/workflows/${workflowId}/memory`,
        { content },
      );
      if (!result.stored) message.warning(result.reason ?? t('notStored'));
      else setDraft('');
      await reload();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await apiDelete(`/workflow-chat/memory/${id}`);
      await reload();
    } catch (error) {
      // Sans cette branche, un refus de l'api ne disait rien : la ligne restait
      // à l'écran et l'on croyait le fait oublié jusqu'à le revoir cité dans la
      // conversation suivante.
      message.error((error as Error).message);
    }
  };

  return (
    <Collapse
      size="small"
      ghost
      items={[
        {
          key: 'memory',
          label: <Typography.Text type="secondary">{t('title', { count: facts.length })}</Typography.Text>,
          children: (
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              {facts.map((fact) => (
                <Space key={fact.id} align="start" style={{ width: '100%' }}>
                  <Popconfirm
                    title={t('forgetConfirm')}
                    okText={t('forget')}
                    okButtonProps={{ danger: true }}
                    cancelText={tCommon('cancel')}
                    onConfirm={() => remove(fact.id)}
                  >
                    <Tooltip title={t('forgetTooltip')}>
                      <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                    </Tooltip>
                  </Popconfirm>
                  <Typography.Text>{fact.content}</Typography.Text>
                </Space>
              ))}
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  size="small"
                  placeholder={t('placeholder')}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onPressEnter={add}
                />
                <Button size="small" icon={<PlusOutlined />} loading={busy} onClick={add}>
                  {t('remember')}
                </Button>
              </Space.Compact>
            </Space>
          ),
        },
      ]}
    />
  );
}
