'use client';

import React from 'react';
import { Tag, Tooltip, Typography } from 'antd';
import { WorkflowDivergence } from './workflow-row';
import { DivergenceModal } from './divergence-modal';

const LABELS: Record<WorkflowDivergence['status'], { color: string; label: string; why: string }> = {
  'in-sync': { color: 'green', label: '= prod', why: 'Cliquer pour voir l’écart' },
  ahead: { color: 'orange', label: 'à déployer', why: 'Cliquer pour voir l’écart' },
  behind: { color: 'volcano', label: 'prod modifiée', why: 'Correctif en prod, à reporter' },
  'not-deployed': { color: 'blue', label: 'jamais déployé', why: 'Aucun exemplaire en prod' },
  unknown: { color: 'default', label: '?', why: 'Non comparable sur cette plateforme' },
};

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
  const [open, setOpen] = React.useState(false);
  if (!divergence) return null;
  const { color, label, why } = LABELS[divergence.status];
  const comparable = COMPARABLE.has(divergence.status);
  const onClick = comparable ? () => setOpen(true) : undefined;
  const style = comparable ? { cursor: 'pointer' } : undefined;
  return (
    <>
      <Tooltip title={why}>
        {divergence.status === 'in-sync' ? (
          // Rien à faire : texte discret, pas un tag du même poids que « à déployer ».
          <Typography.Text type="secondary" style={style} onClick={onClick}>
            {label}
          </Typography.Text>
        ) : (
          <Tag color={color} style={style} onClick={onClick}>
            {label}
          </Tag>
        )}
      </Tooltip>
      {open && <DivergenceModal workflowId={workflowId} onClose={() => setOpen(false)} />}
    </>
  );
}
