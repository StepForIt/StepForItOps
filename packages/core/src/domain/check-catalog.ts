/**
 * Catalogue des contrôles d'analyse : la liste de ce qu'on peut cocher ou
 * décocher avant de lancer une vérification.
 *
 * Le `code` est celui du finding produit — c'est lui qui sert de clé partout
 * (profils, exclusions `FindingIgnore`, filtrage avant persistance). Les groupes
 * n'existent que pour le mode simple : on décoche « Sticky notes », pas ses six
 * règles une à une.
 */

export type CheckModuleId =
  'verifier' | 'js-checker' | 'optimizer' | 'field-checker' | 'model-audit' | 'remote-schema';

export interface CheckGroupDef {
  id: string;
  module: CheckModuleId;
  label: string;
  /** Ce que le groupe cherche, dit en une phrase (aide du mode simple). */
  description: string;
  /**
   * Contrôle coûteux : appel IA ou lecture des exécutions n8n. C'est la raison
   * principale de décocher, donc elle est affichée.
   */
  costly?: boolean;
}

export interface CheckDef {
  code: string;
  group: string;
  label: string;
}

export const CHECK_GROUPS: CheckGroupDef[] = [
  {
    id: 'structure',
    module: 'verifier',
    label: 'Structure',
    description:
      'Refs vers un nœud absent, désactivé ou qui n’aura pas tourné, nœuds orphelins, trigger absent, boucle mal câblée',
  },
  {
    id: 'reliability',
    module: 'verifier',
    label: 'Fiabilité',
    description:
      'HTTP sans retry ni timeout, erreur avalée, secret en clair, valeur d’exemple jamais remplacée',
  },
  {
    id: 'make-structure',
    module: 'verifier',
    label: 'Structure (Make)',
    description:
      'Renvoi vers un module absent ou qui n’aura pas tourné, agrégateur sans itérateur, If/Else sans Merge, secret en clair',
  },
  {
    id: 'make-schema',
    module: 'verifier',
    label: 'Schéma des modules (Make)',
    description:
      'Champ inconnu du module, champ requis sans valeur, valeur hors des choix admis, type inattendu — d’après la description que Make embarque dans le blueprint',
  },
  {
    id: 'ai-logic',
    module: 'verifier',
    label: 'Revue logique (IA)',
    description: 'Lecture du workflow par le modèle : incohérences de logique métier',
    costly: true,
  },
  {
    id: 'js-static',
    module: 'js-checker',
    label: 'Code JS',
    description: 'Analyse statique des nœuds Code : syntaxe, return manquant, $json / $input mal employés',
  },
  {
    id: 'js-ai',
    module: 'js-checker',
    label: 'Revue du code (IA)',
    description: 'Relecture des nœuds Code par le modèle',
    costly: true,
  },
  {
    id: 'naming',
    module: 'optimizer',
    label: 'Naming',
    description: 'Noms de nœuds laissés par défaut, nœuds identiques',
  },
  {
    id: 'sticky',
    module: 'optimizer',
    label: 'Sticky notes',
    description: 'Zones de documentation : couverture, chevauchements, couleurs, zones vides',
  },
  {
    id: 'node-schema',
    module: 'verifier',
    label: 'Conformité des nœuds',
    description:
      'Paramètres confrontés au schéma que n8n donne du type de nœud : sous-clé de collection non déclarée (le workflow ne se réimporte pas), paramètre inconnu, forme inattendue, valeur hors des choix proposés',
  },
  {
    id: 'model-fit',
    module: 'model-audit',
    label: 'Modèles IA — aptitudes et cycle de vie',
    description:
      'Le modèle appelé sait-il faire ce que le nœud demande (images, outils, sortie contrainte, fenêtre de contexte), et est-il encore servi par son provider',
  },
  {
    id: 'model-cost',
    module: 'model-audit',
    label: 'Modèles IA — coût',
    description:
      'Un modèle moins cher rendrait le même service, à niveau conservé ou parce que la tâche du nœud ne demande pas tant',
    costly: true,
  },
  {
    id: 'fields',
    module: 'field-checker',
    label: 'Champs',
    description: 'Champs référencés confrontés au schéma réel des dernières exécutions',
    costly: true,
  },
  {
    id: 'remote-schema',
    module: 'remote-schema',
    label: 'Tables distantes',
    description:
      'Colonnes lues ou écrites (y compris posées par un Set avant un mapping automatique) confrontées aux tables réelles Airtable, NocoDB, Notion, Sheets et Postgres',
    costly: true,
  },
];

export const CHECK_CATALOG: CheckDef[] = [
  // verifier — structure
  { code: 'expression-missing-node', group: 'structure', label: 'Expression vers un nœud inexistant' },
  {
    code: 'expression-not-ancestor',
    group: 'structure',
    label: "Expression vers un nœud qui n'aura pas tourné",
  },
  { code: 'expression-disabled-node', group: 'structure', label: 'Expression vers un nœud désactivé' },
  { code: 'orphan-node', group: 'structure', label: 'Nœud non connecté' },
  { code: 'no-trigger', group: 'structure', label: 'Aucun déclencheur' },
  { code: 'loop-body-on-done', group: 'structure', label: 'Corps de boucle branché sur « done »' },
  { code: 'loop-not-closed', group: 'structure', label: 'Boucle qui ne se referme pas' },

  // verifier — Make. Le graphe y est imbriqué et les renvois sont des ids : les
  // fautes n'ont pas les mêmes noms que côté n8n, elles ont les mêmes effets.
  { code: 'make-ref-unknown', group: 'make-structure', label: 'Renvoi vers un module inexistant' },
  {
    code: 'make-ref-unreachable',
    group: 'make-structure',
    label: 'Renvoi vers un module qui n’aura pas tourné',
  },
  { code: 'make-aggregator-no-feeder', group: 'make-structure', label: 'Agrégateur sans itérateur' },
  {
    code: 'make-aggregator-bad-feeder',
    group: 'make-structure',
    label: 'Agrégateur rattaché à un module qui n’itère rien',
  },
  { code: 'make-ifelse-without-merge', group: 'make-structure', label: 'If/Else sans Merge' },
  {
    code: 'make-merge-filters-mismatch',
    group: 'make-structure',
    label: 'Merge : filtres et branches en nombre différent',
  },
  { code: 'make-secret-in-clear', group: 'make-structure', label: 'Secret en clair dans un module' },
  { code: 'make-placeholder', group: 'make-structure', label: 'Valeur d’exemple jamais remplacée' },

  // verifier — Make, conformité au schéma. Make embarque la description de ses
  // modules dans le blueprint : pas besoin de catalogue pour juger ce qui est écrit.
  { code: 'make-unknown-field', group: 'make-schema', label: 'Champ que le module ne connaît pas' },
  { code: 'make-required-field-missing', group: 'make-schema', label: 'Champ requis sans valeur' },
  { code: 'make-value-not-allowed', group: 'make-schema', label: 'Valeur hors des choix admis' },
  { code: 'make-field-type', group: 'make-schema', label: 'Type de valeur inattendu' },

  // verifier — fiabilité
  { code: 'http-no-retry', group: 'reliability', label: 'HTTP sans retry' },
  { code: 'error-swallowed', group: 'reliability', label: 'Erreur avalée silencieusement' },
  { code: 'hardcoded-secret', group: 'reliability', label: 'Secret en clair' },
  { code: 'http-no-timeout', group: 'reliability', label: 'HTTP sans timeout' },
  { code: 'param-placeholder', group: 'reliability', label: 'Valeur d’exemple jamais remplacée' },

  // verifier — conformité au schéma des nœuds
  { code: 'node-unknown-param', group: 'node-schema', label: 'Paramètre inconnu du type de nœud' },
  { code: 'node-param-type', group: 'node-schema', label: 'Paramètre d’une forme inattendue' },
  { code: 'node-unknown-value', group: 'node-schema', label: 'Valeur hors des choix du nœud' },
  { code: 'node-unknown-collection-key', group: 'node-schema', label: 'Sous-clé de collection non déclarée' },
  {
    code: 'node-expression-collection',
    group: 'node-schema',
    label: 'Expression à la place d’une collection',
  },

  // verifier — revue IA
  { code: 'ai-logic', group: 'ai-logic', label: 'Logique douteuse (IA)' },
  { code: 'ai-summary', group: 'ai-logic', label: 'Résumé du workflow (IA)' },
  { code: 'ai-not-understood', group: 'ai-logic', label: 'Workflow incompris par l’IA' },

  // js-checker
  { code: 'js-syntax-error', group: 'js-static', label: 'Erreur de syntaxe JS' },
  { code: 'js-no-return', group: 'js-static', label: 'Nœud Code sans return' },
  { code: 'js-json-in-all-items', group: 'js-static', label: '$json en mode « all items »' },
  { code: 'js-all-in-each-item', group: 'js-static', label: '$input.all() en mode « each item »' },
  { code: 'js-require', group: 'js-static', label: 'require() dépendant de l’instance' },
  { code: 'js-ai', group: 'js-ai', label: 'Code à revoir (IA)' },

  // optimizer
  { code: 'default-name', group: 'naming', label: 'Nom de nœud par défaut' },
  { code: 'duplicate-nodes', group: 'naming', label: 'Nœuds identiques' },
  { code: 'sticky-uncovered-nodes', group: 'sticky', label: 'Nœuds hors de toute zone' },
  { code: 'sticky-empty-zone', group: 'sticky', label: 'Zone sans nœud' },
  { code: 'sticky-missing-content', group: 'sticky', label: 'Zone non documentée' },
  { code: 'sticky-oversized', group: 'sticky', label: 'Zone trop grande' },
  { code: 'sticky-color-clash', group: 'sticky', label: 'Zone de la couleur de sa parente' },
  { code: 'sticky-overlap', group: 'sticky', label: 'Zones qui se chevauchent' },

  // field-checker
  // model-audit. Les aptitudes viennent du catalogue des modèles, la tâche d'une
  // classification stockée : les deux sont passées aux règles, qui restent pures.
  { code: 'model-missing-vision', group: 'model-fit', label: 'Image envoyée à un modèle sans vision' },
  {
    code: 'model-missing-tools',
    group: 'model-fit',
    label: 'Outils branchés sous un modèle qui ne les appelle pas',
  },
  {
    code: 'model-missing-structured-output',
    group: 'model-fit',
    label: 'Parser structuré sans sortie contrainte',
  },
  { code: 'model-context-too-small', group: 'model-fit', label: 'Fenêtre de contexte trop courte (mesuré)' },
  { code: 'model-retired', group: 'model-fit', label: 'Modèle retiré' },
  { code: 'model-deprecated', group: 'model-fit', label: 'Modèle déprécié' },
  { code: 'model-floating-alias', group: 'model-fit', label: 'Alias de modèle non épinglé' },
  { code: 'model-unknown', group: 'model-fit', label: 'Modèle absent du catalogue' },
  { code: 'model-oversized', group: 'model-cost', label: 'Modèle de raisonnement sans besoin apparent' },
  { code: 'model-cheaper-alternative', group: 'model-cost', label: 'Moins cher à niveau conservé' },
  { code: 'model-cheaper-provider', group: 'model-cost', label: 'Moins cher chez un autre provider' },
  { code: 'model-task-oversized', group: 'model-cost', label: 'Surdimensionné pour la tâche du nœud' },

  { code: 'field-typo', group: 'fields', label: 'Champ mal orthographié' },
  { code: 'field-unknown', group: 'fields', label: 'Champ inconnu des exécutions' },

  { code: 'remote-table-missing', group: 'remote-schema', label: 'Table distante introuvable' },
  { code: 'remote-column-missing', group: 'remote-schema', label: 'Colonne absente de la table distante' },
];

const GROUP_BY_ID = new Map(CHECK_GROUPS.map((group) => [group.id, group]));
const CHECK_BY_CODE = new Map(CHECK_CATALOG.map((check) => [check.code, check]));

export function checkGroup(code: string): CheckGroupDef | undefined {
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
