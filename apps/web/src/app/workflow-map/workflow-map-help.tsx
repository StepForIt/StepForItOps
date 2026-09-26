'use client';

import React, { useEffect, useState } from 'react';
import { Collapse, Space, Tag, Typography } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';

const { Paragraph, Text, Title } = Typography;

/** Documentation intégrée de la carte des workflows : dépliée tant qu'il n'y a aucun lien à voir. */
export function WorkflowMapHelp({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const t = useTranslations('inventory.workflowMap.help');
  const [activeKeys, setActiveKeys] = useState<string[]>(defaultOpen ? ['help'] : []);

  useEffect(() => {
    if (defaultOpen) setActiveKeys(['help']);
  }, [defaultOpen]);

  return (
    <Collapse
      style={{ marginTop: 16 }}
      activeKey={activeKeys}
      onChange={(keys) => setActiveKeys(keys as string[])}
      items={[
        {
          key: 'help',
          label: (
            <Space>
              <QuestionCircleOutlined />
              <Text strong>{t('title')}</Text>
            </Space>
          ),
          children: <HelpContent />,
        },
      ]}
    />
  );
}

/** Balises des textes d'aide : la mise en forme reste ici, le texte dans les messages. */
const RICH = {
  strong: (chunks: React.ReactNode) => <Text strong>{chunks}</Text>,
  code: (chunks: React.ReactNode) => <Text code>{chunks}</Text>,
  em: (chunks: React.ReactNode) => <em>{chunks}</em>,
  tag: (chunks: React.ReactNode) => <Tag>{chunks}</Tag>,
  tagBlue: (chunks: React.ReactNode) => <Tag color="blue">{chunks}</Tag>,
  tagPurple: (chunks: React.ReactNode) => <Tag color="purple">{chunks}</Tag>,
  tagCyan: (chunks: React.ReactNode) => <Tag color="cyan">{chunks}</Tag>,
  tagMagenta: (chunks: React.ReactNode) => <Tag color="magenta">{chunks}</Tag>,
};

function HelpContent() {
  const t = useTranslations('inventory.workflowMap.help');
  return (
    <div style={{ maxWidth: 900 }}>
      <Paragraph>{t.rich('intro', RICH)}</Paragraph>

      <Title level={5}>{t('detected.title')}</Title>
      <Space direction="vertical" size={4} style={{ marginBottom: 16 }}>
        <div>{t.rich('detected.execute', RICH)}</div>
        <div>{t.rich('detected.tool', RICH)}</div>
        <div>{t.rich('detected.webhook', RICH)}</div>
      </Space>
      <Paragraph>{t.rich('detected.context', RICH)}</Paragraph>
      <Paragraph type="secondary">{t.rich('detected.recomputed', RICH)}</Paragraph>

      <Title level={5}>{t('manual.title')}</Title>
      <Paragraph>{t.rich('manual.body', RICH)}</Paragraph>

      <Title level={5}>{t('reading.title')}</Title>
      <ul style={{ paddingLeft: 20, marginBottom: 16 }}>
        <li>{t.rich('reading.lines', RICH)}</li>
        <li>{t.rich('reading.frames', RICH)}</li>
        <li>{t.rich('reading.triggers', RICH)}</li>
        <li>{t.rich('reading.subWorkflow', RICH)}</li>
        <li>{t.rich('reading.self', RICH)}</li>
        <li>{t.rich('reading.archived', RICH)}</li>
        <li>{t.rich('reading.entryPoints', RICH)}</li>
        <li>{t.rich('reading.outOfScope', RICH)}</li>
        <li>{t.rich('reading.isolated', RICH)}</li>
      </ul>

      <Title level={5}>{t('limits.title')}</Title>
      <ul style={{ paddingLeft: 20 }}>
        <li>{t.rich('limits.expression', RICH)}</li>
        <li>{t.rich('limits.webhook', RICH)}</li>
        <li>{t.rich('limits.disabled', RICH)}</li>
        <li>{t.rich('limits.scope', RICH)}</li>
      </ul>
    </div>
  );
}
