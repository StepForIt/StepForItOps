'use client';

import React from 'react';
import { Alert, Checkbox, Space, Tag, Typography } from 'antd';
import { ArrowRightOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useEnvColor, useEnvLabel } from '../../../../lib/envs';

export interface PromoteChainGate {
  ok: boolean;
  mode: 'warn' | 'block';
  /** La lignée de la cible, de la racine jusqu'à elle : le chemin, pas la liste. */
  chain: string[];
  from: string | null;
  to: string | null;
  direction: 'forward' | 'backward' | 'same' | 'unknown';
  skipped: string[];
  steps: Array<{ env: string; instanceId: string; instanceName: string; creates: boolean }>;
  through: boolean;
}

function EnvPath({ envs, highlight }: { envs: Array<string | null>; highlight: string[] }) {
  const envColor = useEnvColor();
  const envLabel = useEnvLabel();
  return (
    <span>
      {envs
        .filter((env): env is string => Boolean(env))
        .map((env, index) => (
          <span key={`${env}-${index}`}>
            {index > 0 && <ArrowRightOutlined style={{ margin: '0 6px', opacity: 0.45 }} />}
            <Tag color={highlight.includes(env) ? envColor(env) : 'default'}>{envLabel(env)}</Tag>
          </span>
        ))}
    </span>
  );
}

/**
 * La chaîne déclarée, et ce que cette promotion en fait. Sauter une étape n'est
 * pas interdit en soi — c'est de le faire sans le savoir qui coûte cher :
 * l'étape intermédiaire ne sert à rien si personne ne remarque qu'on l'a contournée.
 */
export function PromoteChainCard({
  gate,
  through,
  onThrough,
  confirmSkip,
  onConfirmSkip,
}: {
  gate: PromoteChainGate;
  through: boolean;
  onThrough: (value: boolean) => void;
  confirmSkip: boolean;
  onConfirmSkip: (value: boolean) => void;
}) {
  const t = useTranslations('workflowShow.promoteChain');
  const envColor = useEnvColor();
  const envLabel = useEnvLabel();
  // Le chemin n'est pas situable (env indéterminé, ou hors chaîne) : rien à dire.
  if (gate.direction === 'unknown' || gate.skipped.length === 0) {
    if (gate.direction !== 'backward') return null;
    return (
      <Alert
        type="warning"
        showIcon
        message={t('backward', { from: envLabel(gate.from), to: envLabel(gate.to) })}
      />
    );
  }

  const skipped = gate.skipped.map(envLabel).join(', ');
  const blocked = gate.mode === 'block' && !through;

  return (
    <Alert
      type={through ? 'info' : blocked ? 'error' : 'warning'}
      showIcon
      message={through ? t('through', { skipped }) : t('skips', { skipped })}
      description={
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <div>
            <EnvPath envs={gate.chain} highlight={[gate.from ?? '', ...gate.skipped, gate.to ?? '']} />
          </div>
          <Checkbox checked={through} onChange={(event) => onThrough(event.target.checked)}>
            {t('throughCheckbox')}
          </Checkbox>
          {through && (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {gate.steps.map((step) => (
                <li key={step.env}>
                  <Tag color={envColor(step.env)}>{envLabel(step.env)}</Tag>
                  {t('onInstance', { instance: step.instanceName })}{' '}
                  {step.creates ? (
                    <Tag color="green">{t('toCreate')}</Tag>
                  ) : (
                    <Tag color="orange">{t('overwrite')}</Tag>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!through && gate.mode === 'warn' && (
            <Checkbox checked={confirmSkip} onChange={(event) => onConfirmSkip(event.target.checked)}>
              {t('confirmSkip', { skipped })}
            </Checkbox>
          )}
          {blocked && <Typography.Text type="danger">{t('blocked')}</Typography.Text>}
        </Space>
      }
    />
  );
}
