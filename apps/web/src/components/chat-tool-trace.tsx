'use client';

import React from 'react';
import { Collapse, Space, Tag, Typography } from 'antd';
import { useTranslations } from 'next-intl';

/** Résumé du raisonnement d'un tour, tel que l'API le rend. */
export interface ThinkingStep {
  round: number;
  text: string;
}

/** Un appel d'outil, tel que l'API le conserve (cf. `AiToolTrace`). */
export interface ToolTraceStep {
  name: string;
  input: Record<string, unknown>;
  result: string;
  failed: boolean;
}

/**
 * Le résultat d'un outil peut être long (une conversation entière relue). On coupe
 * à l'affichage : le repli sert à comprendre ce que l'assistant est allé chercher,
 * pas à relire son entrée intégrale.
 */
const MAX_RESULT = 1500;

/** L'argument qui identifie l'appel — le nom du nœud, celui du type, l'id visé. */
function subject(input: Record<string, unknown>): string | null {
  for (const key of ['node', 'nodeType', 'sessionId', 'fact']) {
    const value = input?.[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

/**
 * Ce que l'assistant est allé chercher avant de répondre.
 *
 * Replié par défaut : une réponse qui a relu trois nœuds ne doit pas ressembler à
 * une réponse de mémoire, mais le détail des appels n'est utile qu'à qui doute de
 * la réponse. Ça vivait avant DANS le texte du message, où les balises
 * s'affichaient telles quelles et où l'export les emportait.
 */
export function ChatToolTrace({
  steps,
  thinking = [],
}: {
  steps: ToolTraceStep[];
  thinking?: ThinkingStep[];
}) {
  const t = useTranslations('chat.toolTrace');
  if (steps.length === 0 && thinking.length === 0) return null;
  const failures = steps.filter((step) => step.failed).length;
  const severalRounds = new Set(thinking.map((step) => step.round)).size > 1;
  const label = [
    thinking.length > 0 ? t('thinking') : '',
    steps.length > 0 ? t('tools', { count: steps.length }) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Collapse
      size="small"
      ghost
      style={{ marginTop: 4 }}
      items={[
        {
          key: 'trace',
          label: (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              🔍 {label}
              {failures > 0 && ` · ${t('failures', { count: failures })}`}
            </Typography.Text>
          ),
          children: (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              {thinking.map((step, index) => (
                <div key={`thinking-${index}`}>
                  <Space size={6}>
                    <Tag color="purple">{t('thinking')}</Tag>
                    {severalRounds && (
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {t('round', { round: step.round + 1 })}
                      </Typography.Text>
                    )}
                  </Space>
                  <Typography.Paragraph
                    type="secondary"
                    style={{ fontSize: 12, margin: '4px 0 0', whiteSpace: 'pre-wrap' }}
                  >
                    {step.text}
                  </Typography.Paragraph>
                </div>
              ))}
              {steps.map((step, index) => (
                <div key={`${step.name}-${index}`}>
                  <Space size={6} wrap>
                    <Tag color={step.failed ? 'red' : 'blue'}>{step.name}</Tag>
                    {subject(step.input) && (
                      <Typography.Text style={{ fontSize: 12 }}>{subject(step.input)}</Typography.Text>
                    )}
                  </Space>
                  <pre
                    style={{
                      margin: '4px 0 0',
                      padding: 6,
                      background: '#fff',
                      border: '1px solid #f0f0f0',
                      borderRadius: 4,
                      fontSize: 11,
                      maxHeight: 220,
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {step.result.length > MAX_RESULT
                      ? `${step.result.slice(0, MAX_RESULT)}\n${t('truncated')}`
                      : step.result}
                  </pre>
                </div>
              ))}
            </Space>
          ),
        },
      ]}
    />
  );
}
