import { defineMessages } from '../catalog';

/** Contrôles d'analyse : catalogue des contrôles, profils et messages des findings. */
export const checks = defineMessages(
  {
    groupStructureLabel: 'Structure',
    groupStructureDescription:
      "Refs to a missing or disabled node, or to one that won't have run, orphan nodes, missing trigger, miswired loop",
    groupReliabilityLabel: 'Reliability',
    groupReliabilityDescription:
      'HTTP without retry or timeout, swallowed error, secret in clear text, placeholder value never replaced',
    groupMakeStructureLabel: 'Structure (Make)',
    groupMakeStructureDescription:
      "Reference to a missing module or to one that won't have run, aggregator without iterator, If/Else without Merge, secret in clear text",
    groupMakeSchemaLabel: 'Module schema (Make)',
    groupMakeSchemaDescription:
      'Field unknown to the module, required field without a value, value outside the allowed choices, unexpected type — based on the description Make embeds in the blueprint',
    groupAiLogicLabel: 'Logic review (AI)',
    groupAiLogicDescription: 'The model reads the workflow: business logic inconsistencies',
    groupJsStaticLabel: 'JS code',
    groupJsStaticDescription: 'Static analysis of Code nodes: syntax, missing return, misused $json / $input',
    groupJsAiLabel: 'Code review (AI)',
    groupJsAiDescription: 'The model reviews Code nodes',
    groupNamingLabel: 'Naming',
    groupNamingDescription: 'Node names left at their default, identical nodes',
    groupStickyLabel: 'Sticky notes',
    groupStickyDescription: 'Documentation zones: coverage, overlaps, colors, empty zones',
    groupNodeSchemaLabel: 'Node compliance',
    groupNodeSchemaDescription:
      "Parameters checked against the schema n8n gives for the node type: undeclared collection sub-key (the workflow won't re-import), unknown parameter, unexpected shape, value outside the offered choices",
    groupModelFitLabel: 'AI models — capabilities and lifecycle',
    groupModelFitDescription:
      'Can the called model do what the node asks (images, tools, constrained output, context window), and is it still served by its provider',
    groupModelCostLabel: 'AI models — cost',
    groupModelCostDescription:
      "A cheaper model would do the same job, at the same tier or because the node's task doesn't need that much",
    groupFieldsLabel: 'Fields',
    groupFieldsDescription: 'Referenced fields checked against the real schema of the latest executions',
    groupRemoteSchemaLabel: 'Remote tables',
    groupRemoteSchemaDescription:
      'Columns read or written (including those set by a Set before an automatic mapping) checked against the real Airtable, NocoDB, Notion, Sheets and Postgres tables',
    checkExpressionMissingNode: 'Expression to a non-existent node',
    checkExpressionNotAncestor: "Expression to a node that won't have run",
    checkExpressionDisabledNode: 'Expression to a disabled node',
    checkOrphanNode: 'Unconnected node',
    checkNoTrigger: 'No trigger',
    checkLoopBodyOnDone: 'Loop body wired to “done”',
    checkLoopNotClosed: "Loop that doesn't close",
    checkMakeRefUnknown: 'Reference to a non-existent module',
    checkMakeRefUnreachable: "Reference to a module that won't have run",
    checkMakeAggregatorNoFeeder: 'Aggregator without iterator',
    checkMakeAggregatorBadFeeder: "Aggregator attached to a module that doesn't iterate",
    checkMakeIfelseWithoutMerge: 'If/Else without Merge',
    checkMakeMergeFiltersMismatch: 'Merge: filters and branches differ in number',
    checkMakeSecretInClear: 'Secret in clear text in a module',
    checkMakePlaceholder: 'Placeholder value never replaced',
    checkMakeUnknownField: "Field the module doesn't know",
    checkMakeRequiredFieldMissing: 'Required field without a value',
    checkMakeValueNotAllowed: 'Value outside the allowed choices',
    checkMakeFieldType: 'Unexpected value type',
    checkHttpNoRetry: 'HTTP without retry',
    checkErrorSwallowed: 'Error silently swallowed',
    checkHardcodedSecret: 'Secret in clear text',
    checkHttpNoTimeout: 'HTTP without timeout',
    checkParamPlaceholder: 'Placeholder value never replaced',
    checkNodeUnknownParam: 'Parameter unknown to the node type',
    checkNodeParamType: 'Parameter with an unexpected shape',
    checkNodeUnknownValue: "Value outside the node's choices",
    checkNodeUnknownCollectionKey: 'Undeclared collection sub-key',
    checkNodeExpressionCollection: 'Expression in place of a collection',
    checkAiLogic: 'Questionable logic (AI)',
    checkAiSummary: 'Workflow summary (AI)',
    checkAiNotUnderstood: 'Workflow not understood by the AI',
    checkJsSyntaxError: 'JS syntax error',
    checkJsNoReturn: 'Code node without return',
    checkJsJsonInAllItems: '$json in “all items” mode',
    checkJsAllInEachItem: '$input.all() in “each item” mode',
    checkJsRequire: 'Instance-dependent require()',
    checkJsAi: 'Code to review (AI)',
    checkDefaultName: 'Default node name',
    checkDuplicateNodes: 'Identical nodes',
    checkStickyUncoveredNodes: 'Nodes outside any zone',
    checkStickyEmptyZone: 'Zone without nodes',
    checkStickyMissingContent: 'Undocumented zone',
    checkStickyOversized: 'Zone too large',
    checkStickyColorClash: 'Zone with the color of its parent',
    checkStickyOverlap: 'Overlapping zones',
    checkModelMissingVision: 'Image sent to a model without vision',
    checkModelMissingTools: "Tools attached under a model that doesn't call them",
    checkModelMissingStructuredOutput: 'Structured parser without constrained output',
    checkModelContextTooSmall: 'Context window too short (measured)',
    checkModelRetired: 'Retired model',
    checkModelDeprecated: 'Deprecated model',
    checkModelFloatingAlias: 'Unpinned model alias',
    checkModelUnknown: 'Model missing from the catalog',
    checkModelOversized: 'Reasoning model without apparent need',
    checkModelCheaperAlternative: 'Cheaper at the same tier',
    checkModelCheaperProvider: 'Cheaper at another provider',
    checkModelTaskOversized: "Oversized for the node's task",
    checkFieldTypo: 'Misspelled field',
    checkFieldUnknown: 'Field unknown to executions',
    checkRemoteTableMissing: 'Remote table not found',
    checkRemoteColumnMissing: 'Column missing from the remote table',
    scopeLabel:
      '{scope, select, family {this workflow (all its environments)} group {this workflow group} instance {this n8n instance} other {the whole application}}',
    savedAsAppDefault: "Selection saved as the application's default configuration.",
    savedForFamily: 'Selection saved for this workflow (all its environments).',
    twinSelection:
      '{count} workflows{scope, select, group { in this group} instance { on this instance} other {}} would use the same selection.',
    refExclusiveBranch:
      '"{node}" references "{ref}", which sits on an exclusive branch of the same IF/Switch (risk of "node not executed")',
    refDownstream: '"{node}" references "{ref}", which runs AFTER it',
    refOtherTrigger:
      '"{node}" references "{ref}", which depends on another trigger (never the same execution)',
    refMissingNode: '"{node}" references the non-existent node "{ref}"',
    refDisabledNode: '"{node}" references the disabled node "{ref}"',
    orphanNode: 'Node "{node}" is not connected',
    noTrigger: 'No trigger node detected (manual-only workflow?)',
    httpNoRetry: '"{node}" calls an API without “Retry on Fail”',
    httpNoRetryFix:
      'Enable “Retry on Fail” in the node Settings (with a delay between tries) to absorb transient errors — unless the call creates a resource and replaying it would create a duplicate.',
    errorSwallowed: '"{node}" silently continues on error (the failure becomes invisible)',
    errorSwallowedFix:
      'Prefer “Continue (using error output)” with the error branch wired to a handler, or let the execution fail so monitoring sees it.',
    hardcodedSecret: '"{node}" contains a secret in clear text ({excerpt})',
    hardcodedSecretFix:
      'Move the secret into an n8n credential (Header Auth, Bearer…): as a parameter, it is copied into every export and every version of the workflow.',
    httpNoTimeout: '"{node}" calls an API without a timeout',
    httpNoTimeoutFix:
      "Set Options → Timeout on the node: an API that doesn't respond would block the whole execution.",
    loopBodyOnDone: '"{node}" has nothing on its “loop” output: the loop body is wired to “done”',
    loopBodyOnDoneFix:
      'Wire the loop body to the “loop” output (index 1); “done” (index 0) is only for what comes AFTER the loop.',
    loopNotClosed:
      'The “loop” branch of "{node}" does not come back to the node: only one batch will be processed',
    loopNotClosedFix:
      'Connect the last node of the loop body to the input of "{node}": that return is what requests the next batch.',
    paramPlaceholder: '"{node}" still holds a placeholder value ({excerpt})',
    paramPlaceholderFix:
      'Fill {path} with the real value: the node looks configured, but the call will go out with a placeholder value and will only fail on the first real execution.',
    quoted: '“{value}”',
    orSeparator: ' or ',
    typeExpected:
      '{expected, select, object {an object} boolean {a boolean} other {a number}} is expected, this node holds {found}',
    jsonKind:
      '{kind, select, null {null} array {an array} string {a string} number {a number} boolean {a boolean} other {an object}}',
    schemaOrigin: '{source, select, instance {the instance schema} other {the node catalog}}',
    nodeUnknownParam: 'Parameter “{name}” is unknown to the node {nodeType} according to {origin}.',
    nodeParamType: 'Parameter “{name}”: {mismatch} (type {type} according to {origin}).',
    nodeUnknownCollectionKey:
      '{path}: {keys} {count, plural, one {is not a sub-key declared} other {are not sub-keys declared}} by {nodeType} (expected: {expected}). n8n then refuses to import the workflow (“Could not find property option”) or silently drops the value.',
    nodeUnknownCollectionKeyFix: 'In the node “{node}”, rename {keys} under `{path}` to {expected}.',
    nodeExpressionCollection:
      '{path} holds an expression where {nodeType} expects a collection (sub-key {expected}). n8n raises nothing but skips the value: a collection has a FIXED number of entries, no expression can produce a variable number of them.',
    nodeExpressionCollectionFix:
      'Set the entries one by one under `{path}`, or — if a variable number is needed — leave the node and make the call with an HTTP Request using the array built upstream.',
    nodeUnknownValue:
      'Parameter “{name}”: the value “{value}” is not offered by {nodeType}. Allowed values: {allowed}.',
    shapeKind:
      '{kind, select, string {a string} number {a number} boolean {a boolean} array {a list} object {an object} other {null}}',
    paramShape:
      "The parameter “{path}” is {found}, whereas the {witnesses} other {nodeType} nodes of the instance put {expected} there. A shape the n8n editor doesn't expect at this spot can make it fail when opening the workflow.",
    fieldOrigin:
      '“{source}” ({items} items over {executions, plural, one {# execution} other {# executions}})',
    fieldTypo:
      "`{path}` doesn't exist in the output of {origin}; closest field: `{suggestion}` — probably a typo.",
    fieldUnknown:
      "`{path}` doesn't appear in any output sample of {origin}: the field may be misnamed, or only produced in a branch that never ran during the period.",
    inertMapper:
      '“{mode}” mapping: the columns come from the input, this manual mapping is no longer applied',
    inertSetRaw: 'Set node in “JSON” mode: field-by-field assignments are no longer applied',
    inertSetFields: 'Set node in “Fields” mode: the raw JSON is no longer applied',
    inertCode:
      '{language, select, python {Code node in Python: the JavaScript code is no longer run} other {Code node in JavaScript: the Python code is no longer run}}',
    inertHttpOff:
      '“{toggle}” disabled: the {section, select, body {body} query {query} other {headers}} {section, select, headers {are} other {is}} no longer sent',
    inertHttpJson:
      '{section, select, body {body} query {query} other {headers}} entered as JSON: the key/value entry is no longer sent',
    inertHttpPairs:
      '{section, select, body {body} query {query} other {headers}} entered as key/value: the raw JSON is no longer sent',
    remoteTableMissing: 'The table “{table}” cannot be found on {provider}',
    remoteColumnMissing:
      'The column “{column}” that this node {access, select, write {writes} other {reads}}{hasVia, select, true { (key set by the Set “{via}”)} other {}} does not exist in “{table}”{dropped, select, true {: the data will be ignored} other {}}',
    remoteColumnClosest: 'Closest column: “{suggestion}”',
    remoteTableDynamic: 'table designated by an expression: only known at execution time',
    remoteTableUnset: 'table not set in the node',
    remotePartialSource: '{node}: {reason}',
    remoteMappingUnknown: 'unrecognized mapping shape',
    upstreamNoParent: 'no upstream node: the item is not known',
    upstreamOwnData: "this node produces its own data: its keys can't be read from the JSON",
    upstreamSetRaw: 'Set node in JSON mode: the keys are only known at execution time',
    upstreamDynamicName: 'a field name is an expression',
    nocodbHostUnknown:
      'NocoDB API URL unknown for this credential (to be filled in under External resources → Real names)',
    makeRefUnknown: "“{module}” reads the output of module {id}, which doesn't exist in this scenario.",
    makeRefUnreachable:
      "“{module}” reads the output of module {id}, which won't have run: it is elsewhere in the scenario (another route, another branch, or further on).",
    makeAggregatorNoFeeder:
      "{misplaced, select, true {“{module}” holds `feeder` at the root of the module instead of `parameters`: Make ignores it, and the aggregation doesn't happen.} other {“{module}” aggregates without a source: `feeder` is missing from `parameters`.}}",
    makeAggregatorMissingFeeder: "“{module}” aggregates the output of module {feeder}, which doesn't exist.",
    makeAggregatorBadFeeder:
      "“{module}” aggregates “{source}”, which doesn't iterate anything: an aggregator attaches to the iterator that split the bundles.",
    makeIfElseWithoutMerge:
      "“{module}” is not followed by a Merge: the branches don't join back, and nothing that comes after will run.",
    makeMergeFiltersMismatch:
      '“{module}” declares {filters, plural, one {# filter} other {# filters}} for {branches, plural, one {# branch} other {# branches}}: the matching shifts, and the wrong branch falls through.',
    makePlaceholder:
      '“{module}” still holds a placeholder value: it will only fail on the first real execution.',
    makeSecretInClear:
      '“{module}” holds what looks like a secret in clear text: a Make connection keeps it out of the blueprint, which gets exported and shared.',
    makeUnknownField:
      "“{module}” declares “{field}”, which this module doesn't know: Make ignores it, and the value will never arrive.",
    makeRequiredFieldMissing:
      '“{module}” has no value for “{field}”, which the module requires: it will fail at execution.',
    makeValueNotAllowed: '“{module}” puts “{value}” in “{field}”, which only accepts {allowed}.',
    makeFieldType: '“{module}” puts {got} in “{field}”, which the module expects as {expected}.',
    makeKind: '{kind, select, boolean {boolean} number {number} list {list} object {object} other {text}}',
    makeValueDescribed:
      '{kind, select, text {the text “{value}”} boolean {a boolean} number {a number} list {a list} other {an object}}',
    mermaidDynamicTarget: 'dynamically chosen workflow',
    mermaidToolCall: '→ AI tool: {target}',
  },
  {
    groupStructureLabel: 'Structure',
    groupStructureDescription:
      'Refs vers un nœud absent, désactivé ou qui n’aura pas tourné, nœuds orphelins, trigger absent, boucle mal câblée',
    groupReliabilityLabel: 'Fiabilité',
    groupReliabilityDescription:
      'HTTP sans retry ni timeout, erreur avalée, secret en clair, valeur d’exemple jamais remplacée',
    groupMakeStructureLabel: 'Structure (Make)',
    groupMakeStructureDescription:
      'Renvoi vers un module absent ou qui n’aura pas tourné, agrégateur sans itérateur, If/Else sans Merge, secret en clair',
    groupMakeSchemaLabel: 'Schéma des modules (Make)',
    groupMakeSchemaDescription:
      'Champ inconnu du module, champ requis sans valeur, valeur hors des choix admis, type inattendu — d’après la description que Make embarque dans le blueprint',
    groupAiLogicLabel: 'Revue logique (IA)',
    groupAiLogicDescription: 'Lecture du workflow par le modèle : incohérences de logique métier',
    groupJsStaticLabel: 'Code JS',
    groupJsStaticDescription:
      'Analyse statique des nœuds Code : syntaxe, return manquant, $json / $input mal employés',
    groupJsAiLabel: 'Revue du code (IA)',
    groupJsAiDescription: 'Relecture des nœuds Code par le modèle',
    groupNamingLabel: 'Naming',
    groupNamingDescription: 'Noms de nœuds laissés par défaut, nœuds identiques',
    groupStickyLabel: 'Sticky notes',
    groupStickyDescription: 'Zones de documentation : couverture, chevauchements, couleurs, zones vides',
    groupNodeSchemaLabel: 'Conformité des nœuds',
    groupNodeSchemaDescription:
      'Paramètres confrontés au schéma que n8n donne du type de nœud : sous-clé de collection non déclarée (le workflow ne se réimporte pas), paramètre inconnu, forme inattendue, valeur hors des choix proposés',
    groupModelFitLabel: 'Modèles IA — aptitudes et cycle de vie',
    groupModelFitDescription:
      'Le modèle appelé sait-il faire ce que le nœud demande (images, outils, sortie contrainte, fenêtre de contexte), et est-il encore servi par son provider',
    groupModelCostLabel: 'Modèles IA — coût',
    groupModelCostDescription:
      'Un modèle moins cher rendrait le même service, à niveau conservé ou parce que la tâche du nœud ne demande pas tant',
    groupFieldsLabel: 'Champs',
    groupFieldsDescription: 'Champs référencés confrontés au schéma réel des dernières exécutions',
    groupRemoteSchemaLabel: 'Tables distantes',
    groupRemoteSchemaDescription:
      'Colonnes lues ou écrites (y compris posées par un Set avant un mapping automatique) confrontées aux tables réelles Airtable, NocoDB, Notion, Sheets et Postgres',
    checkExpressionMissingNode: 'Expression vers un nœud inexistant',
    checkExpressionNotAncestor: "Expression vers un nœud qui n'aura pas tourné",
    checkExpressionDisabledNode: 'Expression vers un nœud désactivé',
    checkOrphanNode: 'Nœud non connecté',
    checkNoTrigger: 'Aucun déclencheur',
    checkLoopBodyOnDone: 'Corps de boucle branché sur « done »',
    checkLoopNotClosed: 'Boucle qui ne se referme pas',
    checkMakeRefUnknown: 'Renvoi vers un module inexistant',
    checkMakeRefUnreachable: 'Renvoi vers un module qui n’aura pas tourné',
    checkMakeAggregatorNoFeeder: 'Agrégateur sans itérateur',
    checkMakeAggregatorBadFeeder: 'Agrégateur rattaché à un module qui n’itère rien',
    checkMakeIfelseWithoutMerge: 'If/Else sans Merge',
    checkMakeMergeFiltersMismatch: 'Merge : filtres et branches en nombre différent',
    checkMakeSecretInClear: 'Secret en clair dans un module',
    checkMakePlaceholder: 'Valeur d’exemple jamais remplacée',
    checkMakeUnknownField: 'Champ que le module ne connaît pas',
    checkMakeRequiredFieldMissing: 'Champ requis sans valeur',
    checkMakeValueNotAllowed: 'Valeur hors des choix admis',
    checkMakeFieldType: 'Type de valeur inattendu',
    checkHttpNoRetry: 'HTTP sans retry',
    checkErrorSwallowed: 'Erreur avalée silencieusement',
    checkHardcodedSecret: 'Secret en clair',
    checkHttpNoTimeout: 'HTTP sans timeout',
    checkParamPlaceholder: 'Valeur d’exemple jamais remplacée',
    checkNodeUnknownParam: 'Paramètre inconnu du type de nœud',
    checkNodeParamType: 'Paramètre d’une forme inattendue',
    checkNodeUnknownValue: 'Valeur hors des choix du nœud',
    checkNodeUnknownCollectionKey: 'Sous-clé de collection non déclarée',
    checkNodeExpressionCollection: 'Expression à la place d’une collection',
    checkAiLogic: 'Logique douteuse (IA)',
    checkAiSummary: 'Résumé du workflow (IA)',
    checkAiNotUnderstood: 'Workflow incompris par l’IA',
    checkJsSyntaxError: 'Erreur de syntaxe JS',
    checkJsNoReturn: 'Nœud Code sans return',
    checkJsJsonInAllItems: '$json en mode « all items »',
    checkJsAllInEachItem: '$input.all() en mode « each item »',
    checkJsRequire: 'require() dépendant de l’instance',
    checkJsAi: 'Code à revoir (IA)',
    checkDefaultName: 'Nom de nœud par défaut',
    checkDuplicateNodes: 'Nœuds identiques',
    checkStickyUncoveredNodes: 'Nœuds hors de toute zone',
    checkStickyEmptyZone: 'Zone sans nœud',
    checkStickyMissingContent: 'Zone non documentée',
    checkStickyOversized: 'Zone trop grande',
    checkStickyColorClash: 'Zone de la couleur de sa parente',
    checkStickyOverlap: 'Zones qui se chevauchent',
    checkModelMissingVision: 'Image envoyée à un modèle sans vision',
    checkModelMissingTools: 'Outils branchés sous un modèle qui ne les appelle pas',
    checkModelMissingStructuredOutput: 'Parser structuré sans sortie contrainte',
    checkModelContextTooSmall: 'Fenêtre de contexte trop courte (mesuré)',
    checkModelRetired: 'Modèle retiré',
    checkModelDeprecated: 'Modèle déprécié',
    checkModelFloatingAlias: 'Alias de modèle non épinglé',
    checkModelUnknown: 'Modèle absent du catalogue',
    checkModelOversized: 'Modèle de raisonnement sans besoin apparent',
    checkModelCheaperAlternative: 'Moins cher à niveau conservé',
    checkModelCheaperProvider: 'Moins cher chez un autre provider',
    checkModelTaskOversized: 'Surdimensionné pour la tâche du nœud',
    checkFieldTypo: 'Champ mal orthographié',
    checkFieldUnknown: 'Champ inconnu des exécutions',
    checkRemoteTableMissing: 'Table distante introuvable',
    checkRemoteColumnMissing: 'Colonne absente de la table distante',
    scopeLabel:
      '{scope, select, family {ce workflow (tous ses environnements)} group {ce groupe de workflows} instance {cette instance n8n} other {toute l’application}}',
    savedAsAppDefault: 'Sélection enregistrée comme configuration par défaut de l’application.',
    savedForFamily: 'Sélection enregistrée pour ce workflow (tous ses environnements).',
    twinSelection:
      '{count} workflows{scope, select, group { de ce groupe} instance { de cette instance} other {}} utiliseraient la même sélection.',
    refExclusiveBranch:
      '"{node}" référence "{ref}", situé sur une branche exclusive du même IF/Switch (risque "node not executed")',
    refDownstream: '"{node}" référence "{ref}", qui s\'exécute APRÈS lui',
    refOtherTrigger: '"{node}" référence "{ref}", qui dépend d\'un autre trigger (jamais la même exécution)',
    refMissingNode: '"{node}" référence le nœud inexistant "{ref}"',
    refDisabledNode: '"{node}" référence le nœud désactivé "{ref}"',
    orphanNode: 'Nœud "{node}" non connecté',
    noTrigger: 'Aucun nœud trigger détecté (workflow uniquement manuel ?)',
    httpNoRetry: '"{node}" appelle une API sans « Retry on Fail »',
    httpNoRetryFix:
      'Activer « Retry on Fail » dans les Settings du nœud (avec un délai entre essais) pour absorber les erreurs passagères — sauf si l’appel crée une ressource et que le rejouer ferait un doublon.',
    errorSwallowed: '"{node}" continue silencieusement en cas d\'erreur (l\'échec devient invisible)',
    errorSwallowedFix:
      'Préférer « Continue (using error output) » avec la branche d’erreur branchée sur un traitement, ou laisser l’exécution échouer pour que le monitoring la voie.',
    hardcodedSecret: '"{node}" contient un secret en clair ({excerpt})',
    hardcodedSecretFix:
      'Déplacer le secret dans un credential n8n (Header Auth, Bearer…) : en paramètre, il est copié dans chaque export et chaque version du workflow.',
    httpNoTimeout: '"{node}" appelle une API sans timeout',
    httpNoTimeoutFix:
      'Renseigner Options → Timeout sur le nœud : une API qui ne répond pas bloquerait l’exécution entière.',
    loopBodyOnDone: '"{node}" n\'a rien sur sa sortie « loop » : le corps de boucle est branché sur « done »',
    loopBodyOnDoneFix:
      "Branche le corps de la boucle sur la sortie « loop » (index 1) ; « done » (index 0) ne sert qu'à ce qui vient APRÈS la boucle.",
    loopNotClosed: 'La branche « loop » de "{node}" ne revient pas sur le nœud : un seul lot sera traité',
    loopNotClosedFix:
      'Relie le dernier nœud du corps de boucle à l\'entrée de "{node}" : c\'est ce retour qui demande le lot suivant.',
    paramPlaceholder: '"{node}" garde une valeur d\'exemple ({excerpt})',
    paramPlaceholderFix:
      'Renseigner {path} avec la vraie valeur : le nœud a l’air configuré, mais l’appel partira sur une valeur d’exemple et n’échouera qu’à la première exécution réelle.',
    quoted: '« {value} »',
    orSeparator: ' ou ',
    typeExpected:
      '{expected, select, object {un objet} boolean {un booléen} other {un nombre}} est attendu, ce nœud porte {found}',
    jsonKind:
      '{kind, select, null {null} array {un tableau} string {une chaîne} number {un nombre} boolean {un booléen} other {un objet}}',
    schemaOrigin: "{source, select, instance {le schéma de l'instance} other {le catalogue des nœuds}}",
    nodeUnknownParam: "Paramètre « {name} » inconnu du nœud {nodeType} d'après {origin}.",
    nodeParamType: "Paramètre « {name} » : {mismatch} (type {type} d'après {origin}).",
    nodeUnknownCollectionKey:
      "{path} : {keys} {count, plural, one {n''est pas une sous-clé déclarée} other {ne sont pas des sous-clés déclarées}} par {nodeType} (attendu : {expected}). n8n refuse alors d'importer le workflow (« Could not find property option ») ou jette la valeur en silence.",
    nodeUnknownCollectionKeyFix: 'Dans le nœud « {node} », renomme {keys} sous `{path}` en {expected}.',
    nodeExpressionCollection:
      "{path} porte une expression là où {nodeType} attend une collection (sous-clé {expected}). n8n ne lève rien mais saute la valeur : une collection a un nombre d'entrées FIXE, aucune expression ne peut en produire un nombre variable.",
    nodeExpressionCollectionFix:
      "Pose les entrées une à une sous `{path}`, ou — s'il en faut un nombre variable — sors du nœud et fais l'appel en HTTP Request avec le tableau construit en amont.",
    nodeUnknownValue:
      "Paramètre « {name} » : la valeur « {value} » n'est pas proposée par {nodeType}. Valeurs admises : {allowed}.",
    shapeKind:
      '{kind, select, string {une chaîne} number {un nombre} boolean {un booléen} array {une liste} object {un objet} other {null}}',
    paramShape:
      "Le paramètre « {path} » vaut {found}, alors que les {witnesses} autres nœuds {nodeType} de l'instance y mettent {expected}. Une forme que l'éditeur n8n n'attend pas à cet endroit peut le faire échouer à l'ouverture du workflow.",
    fieldOrigin: '« {source} » ({items} items sur {executions} exécution(s))',
    fieldTypo:
      "`{path}` n'existe pas dans la sortie de {origin} ; champ le plus proche : `{suggestion}` — probable faute de frappe.",
    fieldUnknown:
      "`{path}` n'apparaît dans aucun échantillon de sortie de {origin} : le champ est peut-être mal nommé, ou produit seulement dans une branche jamais exécutée sur la période.",
    inertMapper:
      "mapping « {mode} » : les colonnes viennent de l'entrée, ce mapping manuel n'est plus appliqué",
    inertSetRaw: 'nœud Set en mode « JSON » : les affectations champ par champ ne sont plus appliquées',
    inertSetFields: "nœud Set en mode « Fields » : le JSON brut n'est plus appliqué",
    inertCode:
      "{language, select, python {nœud Code en Python : le code JavaScript n'est plus exécuté} other {nœud Code en JavaScript : le code Python n'est plus exécuté}}",
    inertHttpOff:
      "« {toggle} » désactivé : le {section, select, body {corps} query {query} other {en-têtes}} n'est plus envoyé",
    inertHttpJson:
      "{section, select, body {corps} query {query} other {en-têtes}} saisi en JSON : la saisie clé/valeur n'est plus envoyée",
    inertHttpPairs:
      "{section, select, body {corps} query {query} other {en-têtes}} saisi en clé/valeur : le JSON brut n'est plus envoyé",
    remoteTableMissing: 'La table « {table} » est introuvable sur {provider}',
    remoteColumnMissing:
      "La colonne « {column} » que ce nœud {access, select, write {écrit} other {lit}}{hasVia, select, true { (clé posée par le Set « {via} »)} other {}} n'existe pas dans « {table} »{dropped, select, true { : la donnée sera ignorée} other {}}",
    remoteColumnClosest: 'Colonne proche : « {suggestion} »',
    remoteTableDynamic: 'table désignée par une expression : connue seulement à l’exécution',
    remoteTableUnset: 'table non renseignée dans le nœud',
    remotePartialSource: '{node} : {reason}',
    remoteMappingUnknown: 'forme de mapping non reconnue',
    upstreamNoParent: "aucun nœud en amont : l'item n'est pas connu",
    upstreamOwnData: 'ce nœud produit ses propres données : ses clés ne se lisent pas dans le JSON',
    upstreamSetRaw: "nœud Set en mode JSON : les clés ne sont connues qu'à l'exécution",
    upstreamDynamicName: 'un nom de champ est une expression',
    nocodbHostUnknown:
      "URL de l'API NocoDB inconnue pour cette credential (à renseigner dans Tables externes → Vrais noms)",
    makeRefUnknown: "« {module} » lit la sortie du module {id}, qui n'existe pas dans ce scénario.",
    makeRefUnreachable:
      "« {module} » lit la sortie du module {id}, qui n'aura pas tourné : il est ailleurs dans le scénario (autre route, autre branche, ou plus loin).",
    makeAggregatorNoFeeder:
      "{misplaced, select, true {« {module} » porte `feeder` à la racine du module au lieu de `parameters` : Make l'ignore, et l'agrégation ne se fait pas.} other {« {module} » agrège sans source : `feeder` manque dans `parameters`.}}",
    makeAggregatorMissingFeeder: "« {module} » agrège la sortie du module {feeder}, qui n'existe pas.",
    makeAggregatorBadFeeder:
      "« {module} » agrège « {source} », qui n'itère rien : un agrégateur se rattache à l'itérateur qui a découpé les bundles.",
    makeIfElseWithoutMerge:
      "« {module} » n'est pas suivi d'un Merge : les branches ne se rejoignent pas, et rien de ce qui vient après ne s'exécutera.",
    makeMergeFiltersMismatch:
      '« {module} » déclare {filters} filtre(s) pour {branches} branche(s) : le rapprochement se décale, et la mauvaise branche retombe.',
    makePlaceholder:
      "« {module} » porte encore une valeur d'exemple : elle n'échouera qu'à la première exécution réelle.",
    makeSecretInClear:
      "« {module} » porte ce qui ressemble à un secret en clair : une connexion Make le garde hors du blueprint, qui s'exporte et se partage.",
    makeUnknownField:
      "« {module} » déclare « {field} », que ce module ne connaît pas : Make l'ignore, et la valeur n'arrivera jamais.",
    makeRequiredFieldMissing:
      "« {module} » n'a pas de valeur pour « {field} », que le module exige : il échouera à l'exécution.",
    makeValueNotAllowed: "« {module} » met « {value} » dans « {field} », qui n'admet que {allowed}.",
    makeFieldType: '« {module} » met {got} dans « {field} », que le module attend en {expected}.',
    makeKind: '{kind, select, boolean {booléen} number {nombre} list {liste} object {objet} other {texte}}',
    makeValueDescribed:
      '{kind, select, text {le texte « {value} »} boolean {un booléen} number {un nombre} list {une liste} other {un objet}}',
    mermaidDynamicTarget: 'workflow choisi dynamiquement',
    mermaidToolCall: '→ outil IA : {target}',
  },
);
