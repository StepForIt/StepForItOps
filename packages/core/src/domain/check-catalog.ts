/**
 * Catalogue des contrôles d'analyse : la liste de ce qu'on peut cocher ou
 * décocher avant de lancer une vérification.
 *
 * Le `code` est celui du finding produit — c'est lui qui sert de clé partout
 * (profils, exclusions `FindingIgnore`, filtrage avant persistance). Les groupes
 * n'existent que pour le mode simple : on décoche « Sticky notes », pas ses six
 * règles une à une.
 */

import { MessageId, msg } from '../i18n/translate';

export type CheckModuleId =
  'verifier' | 'js-checker' | 'optimizer' | 'field-checker' | 'model-audit' | 'remote-schema';

/** Structure d'un groupe, sans texte : les libellés se lisent dans la langue du lecteur. */
export interface CheckGroupSpec {
  id: string;
  module: CheckModuleId;
  /**
   * Contrôle coûteux : appel IA ou lecture des exécutions n8n. C'est la raison
   * principale de décocher, donc elle est affichée.
   */
  costly?: boolean;
}

export interface CheckGroupDef extends CheckGroupSpec {
  label: string;
  /** Ce que le groupe cherche, dit en une phrase (aide du mode simple). */
  description: string;
}

export interface CheckSpec {
  code: string;
  group: string;
}

export interface CheckDef extends CheckSpec {
  label: string;
}

export const CHECK_GROUPS: CheckGroupSpec[] = [
  {
    id: 'structure',
    module: 'verifier',
  },
  {
    id: 'reliability',
    module: 'verifier',
  },
  {
    id: 'make-structure',
    module: 'verifier',
  },
  {
    id: 'make-schema',
    module: 'verifier',
  },
  {
    id: 'ai-logic',
    module: 'verifier',
    costly: true,
  },
  {
    id: 'js-static',
    module: 'js-checker',
  },
  {
    id: 'js-ai',
    module: 'js-checker',
    costly: true,
  },
  {
    id: 'naming',
    module: 'optimizer',
  },
  {
    id: 'sticky',
    module: 'optimizer',
  },
  {
    id: 'node-schema',
    module: 'verifier',
  },
  {
    id: 'model-fit',
    module: 'model-audit',
  },
  {
    id: 'model-cost',
    module: 'model-audit',
    costly: true,
  },
  {
    id: 'fields',
    module: 'field-checker',
    costly: true,
  },
  {
    id: 'remote-schema',
    module: 'remote-schema',
    costly: true,
  },
];

export const CHECK_CATALOG: CheckSpec[] = [
  // verifier — structure
  { code: 'expression-missing-node', group: 'structure' },
  {
    code: 'expression-not-ancestor',
    group: 'structure',
  },
  { code: 'expression-disabled-node', group: 'structure' },
  { code: 'orphan-node', group: 'structure' },
  { code: 'no-trigger', group: 'structure' },
  { code: 'loop-body-on-done', group: 'structure' },
  { code: 'loop-not-closed', group: 'structure' },

  // verifier — Make. Le graphe y est imbriqué et les renvois sont des ids : les
  // fautes n'ont pas les mêmes noms que côté n8n, elles ont les mêmes effets.
  { code: 'make-ref-unknown', group: 'make-structure' },
  {
    code: 'make-ref-unreachable',
    group: 'make-structure',
  },
  { code: 'make-aggregator-no-feeder', group: 'make-structure' },
  {
    code: 'make-aggregator-bad-feeder',
    group: 'make-structure',
  },
  { code: 'make-ifelse-without-merge', group: 'make-structure' },
  {
    code: 'make-merge-filters-mismatch',
    group: 'make-structure',
  },
  { code: 'make-secret-in-clear', group: 'make-structure' },
  { code: 'make-placeholder', group: 'make-structure' },

  // verifier — Make, conformité au schéma. Make embarque la description de ses
  // modules dans le blueprint : pas besoin de catalogue pour juger ce qui est écrit.
  { code: 'make-unknown-field', group: 'make-schema' },
  { code: 'make-required-field-missing', group: 'make-schema' },
  { code: 'make-value-not-allowed', group: 'make-schema' },
  { code: 'make-field-type', group: 'make-schema' },

  // verifier — fiabilité
  { code: 'http-no-retry', group: 'reliability' },
  { code: 'error-swallowed', group: 'reliability' },
  { code: 'hardcoded-secret', group: 'reliability' },
  { code: 'http-no-timeout', group: 'reliability' },
  { code: 'param-placeholder', group: 'reliability' },

  // verifier — conformité au schéma des nœuds
  { code: 'node-unknown-param', group: 'node-schema' },
  { code: 'node-param-type', group: 'node-schema' },
  { code: 'node-unknown-value', group: 'node-schema' },
  { code: 'node-unknown-collection-key', group: 'node-schema' },
  {
    code: 'node-expression-collection',
    group: 'node-schema',
  },

  // verifier — revue IA
  { code: 'ai-logic', group: 'ai-logic' },
  { code: 'ai-summary', group: 'ai-logic' },
  { code: 'ai-not-understood', group: 'ai-logic' },

  // js-checker
  { code: 'js-syntax-error', group: 'js-static' },
  { code: 'js-no-return', group: 'js-static' },
  { code: 'js-json-in-all-items', group: 'js-static' },
  { code: 'js-all-in-each-item', group: 'js-static' },
  { code: 'js-require', group: 'js-static' },
  { code: 'js-ai', group: 'js-ai' },

  // optimizer
  { code: 'default-name', group: 'naming' },
  { code: 'duplicate-nodes', group: 'naming' },
  { code: 'sticky-uncovered-nodes', group: 'sticky' },
  { code: 'sticky-empty-zone', group: 'sticky' },
  { code: 'sticky-missing-content', group: 'sticky' },
  { code: 'sticky-oversized', group: 'sticky' },
  { code: 'sticky-color-clash', group: 'sticky' },
  { code: 'sticky-overlap', group: 'sticky' },

  // field-checker
  // model-audit. Les aptitudes viennent du catalogue des modèles, la tâche d'une
  // classification stockée : les deux sont passées aux règles, qui restent pures.
  { code: 'model-missing-vision', group: 'model-fit' },
  {
    code: 'model-missing-tools',
    group: 'model-fit',
  },
  {
    code: 'model-missing-structured-output',
    group: 'model-fit',
  },
  { code: 'model-context-too-small', group: 'model-fit' },
  { code: 'model-retired', group: 'model-fit' },
  { code: 'model-deprecated', group: 'model-fit' },
  { code: 'model-floating-alias', group: 'model-fit' },
  { code: 'model-unknown', group: 'model-fit' },
  { code: 'model-oversized', group: 'model-cost' },
  { code: 'model-cheaper-alternative', group: 'model-cost' },
  { code: 'model-cheaper-provider', group: 'model-cost' },
  { code: 'model-task-oversized', group: 'model-cost' },

  { code: 'field-typo', group: 'fields' },
  { code: 'field-unknown', group: 'fields' },

  { code: 'remote-table-missing', group: 'remote-schema' },
  { code: 'remote-column-missing', group: 'remote-schema' },
];

/** `make-structure` → `MakeStructure` : la clé du message se déduit de l'id. */
function pascal(id: string): string {
  return id
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/** Groupes avec leurs libellés, dans la langue courante (au moment où le catalogue est servi). */
export function checkGroupsLocalized(): CheckGroupDef[] {
  return CHECK_GROUPS.map((group) => ({
    ...group,
    label: msg(`checks.group${pascal(group.id)}Label` as MessageId),
    description: msg(`checks.group${pascal(group.id)}Description` as MessageId),
  }));
}

/** Contrôles avec leurs libellés, dans la langue courante. */
export function checkCatalogLocalized(): CheckDef[] {
  return CHECK_CATALOG.map((check) => ({
    ...check,
    label: msg(`checks.check${pascal(check.code)}` as MessageId),
  }));
}

const GROUP_BY_ID = new Map(CHECK_GROUPS.map((group) => [group.id, group]));
const CHECK_BY_CODE = new Map(CHECK_CATALOG.map((check) => [check.code, check]));

export function checkGroup(code: string): CheckGroupSpec | undefined {
  const check = CHECK_BY_CODE.get(code);
  return check ? GROUP_BY_ID.get(check.group) : undefined;
}

/** Module qui produit ce code, ou undefined pour un code hors catalogue. */
export function checkModuleOf(code: string): CheckModuleId | undefined {
  return checkGroup(code)?.module;
}

/** Codes du catalogue portés par un module. */
export function checkCodesOfModule(module: CheckModuleId): string[] {
  return CHECK_CATALOG.filter((check) => checkGroup(check.code)?.module === module).map((c) => c.code);
}

/** Codes d'un groupe (mode simple → cases individuelles). */
export function checkCodesOfGroup(groupId: string): string[] {
  return CHECK_CATALOG.filter((check) => check.group === groupId).map((check) => check.code);
}

/**
 * Nettoie une liste de codes désactivés : hors catalogue écartés, doublons
 * fusionnés, ordre stable. Deux sélections égales donnent ainsi deux listes
 * identiques — c'est ce qui permet de les comparer entre périmètres.
 */
export function normalizeDisabled(codes: readonly string[]): string[] {
  const known = new Set(codes.filter((code) => CHECK_BY_CODE.has(code)));
  return CHECK_CATALOG.filter((check) => known.has(check.code)).map((check) => check.code);
}

/** Un contrôle est actif tant qu'il n'est pas explicitement décoché. */
export function isCheckEnabled(disabled: readonly string[], code: string): boolean {
  return !disabled.includes(code);
}

/** Codes actifs d'un module — vide = rien à analyser, l'appel peut être évité. */
export function enabledCodesOfModule(disabled: readonly string[], module: CheckModuleId): string[] {
  const off = new Set(disabled);
  return checkCodesOfModule(module).filter((code) => !off.has(code));
}

/** Aucun contrôle actif pour ce module : l'analyse entière peut être sautée. */
export function isModuleFullyDisabled(disabled: readonly string[], module: CheckModuleId): boolean {
  return enabledCodesOfModule(disabled, module).length === 0;
}

/** Tous les contrôles d'un groupe sont-ils décochés (état des cases du mode simple) ? */
export function isGroupFullyDisabled(disabled: readonly string[], groupId: string): boolean {
  const off = new Set(disabled);
  return checkCodesOfGroup(groupId).every((code) => off.has(code));
}
