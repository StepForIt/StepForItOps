'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Tabs, Tag, Tooltip, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { apiGet } from '../../../../lib/api';
import { useInstanceScope } from '../../../../lib/instance-scope';
import { WorkflowRow } from '../../workflow-row';
import { useEnvs } from '../../../../lib/envs';
import { LockIcon } from '../../../../components/workflow-lock';

/**
 * Les environnements du workflow métier, en ONGLETS : on passe de la dev à la
 * prod comme on change d'onglet, sans repasser par la liste.
 *
 * Un env déclaré où ce workflow n'existe pas encore est montré quand même, en
 * grisé : son absence est une information (« la prod n'a jamais reçu ce
 * workflow »), et le clic propose d'y copier un exemplaire existant plutôt que
 * de ne rien faire.
 */
export function EnvLinks({
  workflow,
  onCopyTo,
}: {
  workflow: WorkflowRow;
  /** Env déclaré, sans exemplaire : on propose la copie. */
  onCopyTo: (envId: string) => void;
}) {
  const t = useTranslations('workflowShow.envLinks');
  const { envs } = useEnvs();
  const router = useRouter();
  const [siblings, setSiblings] = useState<WorkflowRow[]>([]);
  const { instanceName } = useInstanceScope();

  useEffect(() => {
    apiGet<WorkflowRow[]>(`/workflows/${workflow.id}/siblings`)
      .then(setSiblings)
      .catch(() => setSiblings([]));
  }, [workflow.id]);

  const all = [workflow, ...siblings];
  const byEnv = new Map(all.filter((row) => row.env).map((row) => [row.env as string, row]));
  const hint = (row: WorkflowRow) =>
    [
      row.name,
      instanceName(row.instanceId),
      row.active ? t('active') : t('inactive'),
      ...(row.archived ? [t('archived')] : []),
      ...(row.missingInN8n ? [t('missing')] : []),
    ].join(' · ');

  // Les envs déclarés donnent l'ordre ; un exemplaire sans env déclaré garde le sien
  // en fin de file, sinon la page qu'on regarde n'aurait pas d'onglet.
  const items = envs.map((env) => {
    const row = byEnv.get(env.id);
    return {
      key: env.id,
      label: row ? (
        <Tooltip title={hint(row)}>
          <span style={{ opacity: row.active || row.id === workflow.id ? 1 : 0.65 }}>
            {env.id.toUpperCase()}
            {row.instanceId !== workflow.instanceId ? ` · ${instanceName(row.instanceId)}` : ''}{' '}
            <LockIcon workflowId={row.id} />
          </span>
        </Tooltip>
      ) : (
        <Tooltip title={t('noCopyTooltip', { env: env.id.toUpperCase() })}>
          <Typography.Text type="secondary">
            {env.id.toUpperCase()} <Tag style={{ marginInlineEnd: 0 }}>{t('toCreate')}</Tag>
          </Typography.Text>
        </Tooltip>
      ),
    };
  });
  const unknown = all.filter((row) => !row.env);
  if (unknown.some((row) => row.id === workflow.id))
    items.push({ key: UNKNOWN_ENV, label: <Tooltip title={hint(workflow)}>{t('unknownEnv')}</Tooltip> });

  if (items.length === 0) return null;

  return (
    <Tabs
      size="small"
      style={{ marginTop: 4 }}
      activeKey={workflow.env ?? UNKNOWN_ENV}
      items={items}
      onChange={(key) => {
        const row = byEnv.get(key);
        if (row) router.push(`/workflows/show/${row.id}`);
        else onCopyTo(key);
      }}
    />
  );
}

/** Clé de l'onglet d'un exemplaire dont l'env n'est pas déclaré. */
const UNKNOWN_ENV = '__unknown';
