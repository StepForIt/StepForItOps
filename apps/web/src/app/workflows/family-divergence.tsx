'use client';

import React from 'react';
import { Space, Tag, Tooltip, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { DivergenceModal } from './divergence-modal';
import { WorkflowFamily } from './workflow-row';
import { useEnvColor, useEnvLabel } from '../../lib/envs';

/**
 * Résumé de la famille : quels envs ont quelque chose à pousser vers la prod.
 * « à jour » seulement quand au moins un exemplaire a été comparé et que tous égalent la prod.
 */
export function FamilyDivergence({ family }: { family: WorkflowFamily }) {
  const t = useTranslations('workflowsList.divergence');
  const envColor = useEnvColor();
  const envLabel = useEnvLabel();
  const [openId, setOpenId] = React.useState<string | null>(null);
  const compared = family.members.filter((member) => member.divergence);
  if (compared.length === 0) return null;
  const inSync = compared.every((member) => member.divergence?.status === 'in-sync');
  // Un tag de famille ouvre l'écart de l'exemplaire qu'il résume ; « jamais déployé »
  // n'a pas de prod à laquelle se comparer, il reste un simple tag.
  const ahead = (env: string) =>
    compared.find((member) => member.env === env && member.divergence?.status === 'ahead');
  const behind = compared.find((member) => member.divergence?.status === 'behind');
  const clickable = (id: string | undefined) =>
    id ? { style: { cursor: 'pointer' }, onClick: () => setOpenId(id) } : {};
  return (
    <Space size={4} wrap>
      {inSync && <Typography.Text type="secondary">{t('family.inSync')}</Typography.Text>}
      {family.toDeploy.map((env) => (
        <Tooltip key={env} title={ahead(env) ? t('why.clickToSee') : t('family.neverDeployed')}>
          <Tag color={envColor(env)} {...clickable(ahead(env)?.id)}>
            {t('family.toDeploy', { env: envLabel(env) })}
          </Tag>
        </Tooltip>
      ))}
      {family.prodAhead && (
        <Tooltip title={t('why.behind')}>
          <Tag color="volcano" {...clickable(behind?.id)}>
            {t('labels.behind')}
          </Tag>
        </Tooltip>
      )}
      {openId && <DivergenceModal workflowId={openId} onClose={() => setOpenId(null)} />}
    </Space>
  );
}
