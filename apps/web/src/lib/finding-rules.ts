/**
 * Libellés lisibles des règles d'analyse. Le `code` sert de clé aux exclusions
 * (`FindingIgnore`) : il reste tel quel en base et dans l'API, seul l'affichage est traduit.
 */
const RULE_LABELS: Record<string, string> = {
  // verifier — revue IA
  'ai-summary': 'Résumé du workflow (IA)',
  'ai-logic': 'Logique douteuse (IA)',
  'ai-not-understood': 'Workflow incompris par l’IA',

  // verifier — contrôles structurels
  'expression-missing-node': 'Expression vers un nœud inexistant',
  'expression-not-ancestor': "Expression vers un nœud qui n'aura pas tourné",
  'expression-disabled-node': 'Expression vers un nœud désactivé',
  'orphan-node': 'Nœud non connecté',
  'no-trigger': 'Aucun déclencheur',

  // verifier — fiabilité
  'http-no-retry': 'HTTP sans retry',
  'error-swallowed': 'Erreur avalée silencieusement',
  'hardcoded-secret': 'Secret en clair',
  'http-no-timeout': 'HTTP sans timeout',
  'param-placeholder': 'Valeur d’exemple jamais remplacée',

  // field-checker
  'field-typo': 'Champ mal orthographié',
  'field-unknown': 'Champ inconnu des exécutions',

  // js-checker
  'js-syntax-error': 'Erreur de syntaxe JS',
  'js-no-return': 'Nœud Code sans return',
  'js-json-in-all-items': '$json en mode « all items »',
  'js-all-in-each-item': '$input.all() en mode « each item »',
  'js-require': 'require() dépendant de l’instance',
  'js-ai': 'Code à revoir (IA)',

  // optimizer — naming
  'default-name': 'Nom de nœud par défaut',
  'duplicate-nodes': 'Nœuds identiques',

  // optimizer — sticky notes
  'sticky-uncovered-nodes': 'Nœuds hors de toute zone',
  'sticky-empty-zone': 'Zone sans nœud',
  'sticky-missing-content': 'Zone non documentée',
  'sticky-oversized': 'Zone trop grande',
  'sticky-color-clash': 'Zone de la couleur de sa parente',
  'sticky-overlap': 'Zones qui se chevauchent',
};

/** Libellé d'une règle ; à défaut le code brut, pour qu'une nouvelle règle reste lisible. */
export function ruleLabel(code: string): string {
  return RULE_LABELS[code] ?? code;
}
