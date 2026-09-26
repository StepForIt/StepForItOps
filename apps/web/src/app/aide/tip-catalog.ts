import React from 'react';
import { useTranslations } from 'next-intl';

export interface Tip {
  id: TipId;
  group: TipGroupId;
  title: string;
  text: string;
  /** Où le geste se trouve dans la console. */
  where: string;
  href: string;
  /** Module qui porte la fonction : désactivé, l'astuce reste visible mais grisée. */
  module?: string;
  /** Synonymes pour la recherche, jamais affichés. */
  keywords?: string;
}

export const TIP_GROUP_IDS = [
  'workflows',
  'quality',
  'assistant',
  'environments',
  'health',
  'history',
] as const;
export type TipGroupId = (typeof TIP_GROUP_IDS)[number];

// Les textes vivent dans messages/<langue>/misc.json (aide.tips.<id>, aide.groups.<id>).
const TIP_DEFS = [
  { id: 'families', group: 'workflows', href: '/workflows' },
  { id: 'divergence', group: 'workflows', href: '/workflows' },
  { id: 'palette', group: 'workflows', href: '#palette' },
  { id: 'bulk', group: 'workflows', href: '/workflows' },
  { id: 'list-memory', group: 'workflows', href: '/workflows' },
  { id: 'checks', group: 'quality', href: '/workflows', module: 'verifier' },
  { id: 'findings-fix', group: 'quality', href: '/findings', module: 'workflow-chat' },
  { id: 'ignore', group: 'quality', href: '/finding-ignores' },
  { id: 'stub', group: 'quality', href: '/workflows', module: 'tester' },
  { id: 'remote', group: 'quality', href: '/workflows' },
  { id: 'assistant', group: 'assistant', href: '/workflows', module: 'workflow-chat' },
  { id: 'error-fix', group: 'assistant', href: '/errors', module: 'workflow-chat' },
  { id: 'promote', group: 'environments', href: '/workflows', module: 'env-switcher' },
  { id: 'mapping', group: 'environments', href: '/resource-mappings', module: 'env-switcher' },
  { id: 'errors', group: 'health', href: '/errors', module: 'monitoring' },
  { id: 'drift', group: 'health', href: '/performance', module: 'performance' },
  { id: 'costs', group: 'health', href: '/llm-costs', module: 'ai-cost' },
  { id: 'restore', group: 'history', href: '/versions', module: 'versioning' },
  { id: 'resources', group: 'history', href: '/resources', module: 'dep-graph' },
] as const satisfies ReadonlyArray<{ id: string; group: TipGroupId; href: string; module?: string }>;

export type TipId = (typeof TIP_DEFS)[number]['id'];

type TipField = 'title' | 'text' | 'where' | 'keywords';
/** Le `t` de `useTranslations('misc.aide')`, réduit aux clés du catalogue. */
export type TipTranslator = (key: `tips.${TipId}.${TipField}` | `groups.${TipGroupId}`) => string;

export function localizeTips(t: TipTranslator): Tip[] {
  return TIP_DEFS.map((def) => ({
    ...def,
    title: t(`tips.${def.id}.title`),
    text: t(`tips.${def.id}.text`),
    where: t(`tips.${def.id}.where`),
    keywords: t(`tips.${def.id}.keywords`),
  }));
}

export function localizeTipGroups(t: TipTranslator): Array<{ id: TipGroupId; label: string }> {
  return TIP_GROUP_IDS.map((id) => ({ id, label: t(`groups.${id}`) }));
}

/** Le catalogue dans la langue courante. */
export function useTips(): { tips: Tip[]; groups: Array<{ id: TipGroupId; label: string }> } {
  const t = useTranslations('misc.aide');
  return React.useMemo(() => ({ tips: localizeTips(t), groups: localizeTipGroups(t) }), [t]);
}
