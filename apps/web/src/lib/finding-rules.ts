import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Libellés lisibles des règles d'analyse. Le `code` sert de clé aux exclusions
 * (`FindingIgnore`) : il reste tel quel en base et dans l'API, seul l'affichage est traduit
 * (`reviewTools.rules.<code>`).
 */
const RULE_CODES = [
  // verifier — revue IA
  'ai-summary',
  'ai-logic',
  'ai-not-understood',

  // verifier — contrôles structurels
  'expression-missing-node',
  'expression-not-ancestor',
  'expression-disabled-node',
  'orphan-node',
  'no-trigger',

  // verifier — fiabilité
  'http-no-retry',
  'error-swallowed',
  'hardcoded-secret',
  'http-no-timeout',
  'param-placeholder',

  // field-checker
  'field-typo',
  'field-unknown',

  // js-checker
  'js-syntax-error',
  'js-no-return',
  'js-json-in-all-items',
  'js-all-in-each-item',
  'js-require',
  'js-ai',

  // optimizer — naming
  'default-name',
  'duplicate-nodes',

  // optimizer — sticky notes
  'sticky-uncovered-nodes',
  'sticky-empty-zone',
  'sticky-missing-content',
  'sticky-oversized',
  'sticky-color-clash',
  'sticky-overlap',
] as const;

type RuleCode = (typeof RULE_CODES)[number];
export type RuleT = ReturnType<typeof useTranslations<'reviewTools.rules'>>;

const isKnownRule = (code: string): code is RuleCode => (RULE_CODES as readonly string[]).includes(code);

/** Libellé d'une règle ; à défaut le code brut, pour qu'une nouvelle règle reste lisible. */
export function ruleLabel(code: string, t: RuleT): string {
  return isKnownRule(code) ? t(code) : code;
}

/** `ruleLabel` lié à la langue courante. */
export function useRuleLabel(): (code: string) => string {
  const t = useTranslations('reviewTools.rules');
  return useCallback((code: string) => ruleLabel(code, t), [t]);
}
