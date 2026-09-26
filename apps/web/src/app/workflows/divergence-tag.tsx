'use client';

import React from 'react';
import { Tag, Tooltip, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { WorkflowDivergence } from './workflow-row';
import { DivergenceModal } from './divergence-modal';

const LABELS = {
  'in-sync': { color: 'green', label: 'labels.inSync', why: 'why.clickToSee' },
  ahead: { color: 'orange', label: 'labels.ahead', why: 'why.clickToSee' },
  behind: { color: 'volcano', label: 'labels.behind', why: 'why.behind' },
  'not-deployed': { color: 'blue', label: 'labels.notDeployed', why: 'why.notDeployed' },
  unknown: { color: 'default', label: 'labels.unknown', why: 'why.unknown' },
} as const satisfies Record<WorkflowDivergence['status'], { color: string; label: string; why: string }>;

/** Là où il y a un contenu à comparer : le reste n'a pas de prod, ou pas d'empreinte. */
const COMPARABLE = new Set<WorkflowDivergence['status']>(['in-sync', 'ahead', 'behind']);

/**
 * Écart d'un exemplaire avec la prod ; rien pour la prod elle-même. Un clic ouvre
 * CE QUI diffère : le tag seul dit qu'il y a un écart, pas de quoi décider.
 */
export function DivergenceTag({
  workflowId,
  divergence,
}: {
  workflowId: string;
  divergence?: WorkflowDivergence | null;
}) {
  const t = useTranslations('workflowsList.divergence');
  const [open, setOpen] = React.useState(false);
  if (!divergence) return null;
  const { color, label, why } = LABELS[divergence.status];
  const comparable = COMPARABLE.has(divergence.status);
  const onClick = comparable ? () => setOpen(true) : undefined;
  const style = comparable ? { cursor: 'pointer' } : undefined;
  return (
    <>
      <Tooltip title={t(why)}>
        {divergence.status === 'in-sync' ? (
          // Rien à faire : texte discret, pas un tag du même poids que « à déployer ».
          <Typography.Text type="secondary" style={style} onClick={onClick}>
            {t(label)}
          </Typography.Text>
        ) : (
          <Tag color={color} style={style} onClick={onClick}>
            {t(label)}
          </Tag>
        )}
      </Tooltip>
      {open && <DivergenceModal workflowId={workflowId} onClose={() => setOpen(false)} />}
    </>
  );
}
