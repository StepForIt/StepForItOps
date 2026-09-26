import { defineMessages } from '../catalog';

/** Modules d'analyse : audit des modèles, naming, stickies, nœuds Code, catalogues, profils de contrôles. */
export const analysis = defineMessages(
  {
    moduleVerifierName: 'Verification',
    moduleVerifierDescription: 'Structural verification, reliability and AI logic review',
    moduleJsCheckerName: 'JS verification',
    moduleJsCheckerDescription: 'Code node analysis: syntax, heuristics, AI review',
    moduleFieldCheckerName: 'Fields vs executions',
    moduleFieldCheckerDescription: 'Referenced fields checked against real executions',
    moduleOptimizerName: 'Optimisation',
    moduleOptimizerDescription: 'Naming, useless nodes and safe renaming',
    moduleRemoteSchemaName: 'Remote tables',
    moduleRemoteSchemaDescription: 'Columns of remote tables expected by workflows',
    moduleOrganizerName: 'Organisation',
    moduleOrganizerDescription: 'Tidying and naming plan for workflows (AI)',
    moduleDocSchemaName: 'Documentation',
    moduleDocSchemaDescription: 'Mermaid diagram and AI summary of a workflow',
    moduleModelAuditName: 'AI model audit',
    moduleModelAuditDescription: 'Capabilities, lifecycle and cost of LLM models',

    quoted: '"{name}"',

    auditFloatingAlias: 'Model "{model}" is a floating alias: it changes without the workflow changing.',
    auditFloatingAliasFix: 'Pin a dated version, so that the workflow behaviour is decided here.',
    auditUnknown: 'Model "{model}" is missing from the catalog: no pricing and no judgement possible.',
    auditUnknownFix: 'Add its row to the model catalog so that costs and audit take it into account.',
    auditOversized:
      '"{pattern}" is a reasoning model, and nothing here asks for tools, images or a long context.',
    auditOversizedFix: 'Check whether a lighter model would do: reasoning is paid on every call.',
    auditMissingVision: 'An image is sent to "{pattern}", which cannot read it.',
    auditMissingVisionFix: 'Choose a model that accepts images, or remove the image input from the chain.',
    auditMissingTools:
      'The agent carries tools but "{pattern}" cannot call them: it will run without ever using one.',
    auditMissingToolsFix: 'Choose a model that supports tool calling.',
    auditMissingStructured:
      'A structured parser is wired behind "{pattern}", which does not guarantee the shape of its output.',
    auditMissingStructuredFix:
      'Choose a model with constrained output, or accept the fallback to best-effort parsing.',
    auditContextTooSmall:
      'Measured inputs (p95: {p95, number} tokens) come close to the window of "{pattern}" ({window, number}).',
    auditContextTooSmallFix:
      'Move to a model with a larger window, or reduce what is injected into the prompt.',
    auditRetired:
      '"{pattern}" is retired: the call fails, or will fail on the next run.{hasSuccessor, select, true { Announced successor: {successor}.} other {}}',
    auditSwitchTo: 'Switch to {pattern}.',
    auditRetiredFixNoSuccessor: 'Choose a model the provider still serves.',
    auditDeprecated:
      '"{pattern}" is deprecated.{hasDeadline, select, true { Retirement announced for {deadline}.} other {}}{hasSuccessor, select, true { Announced successor: {successor}.} other {}}',
    auditDeprecatedFix: 'Switch to {pattern} before the deadline.',
    auditDeprecatedFixNoSuccessor: 'Plan the switch before the retirement.',
    auditTaskLabel:
      '{task, select, translation {Translation} classification {Classification} extraction {Data extraction} summarization {Summary} rewriting {Rewriting} generation {Writing} code {Code} reasoning {Reasoning} conversation {Conversation} other {{task}}}',
    auditTaskOversized:
      '{label}: a lighter model is enough. {current} → {candidate}, −{pct} % on the price{hasAnnual, select, true {, ~{annual} $/year at measured volumes} other {}}. Check it on a test case before switching.',
    auditTaskOversizedFix:
      'Switch to {candidate}, then replay a test case: moving down a tier changes the output, it is not done blindly.',
    auditCheaperProvider:
      'At another provider, {candidate} ({provider}) does the same job for −{pct} %{hasAnnual, select, true {, ~{annual} $/year at measured volumes} other {}}.',
    auditCheaperSame:
      '{candidate} has the same capabilities and the same tier for −{pct} %{hasAnnual, select, true {, ~{annual} $/year at measured volumes} other {}}.',
    auditCheaperProviderFix:
      'Changing provider means another node, another credential and a prompt to readjust: to be assessed, not applied in one click.',
    auditCheaperSameFix: 'Switch to {candidate}: tier and capabilities preserved.',
    unknownProvider: 'unknown',

    taskLabel:
      '{task, select, translation {Translation} classification {Classification} extraction {Data extraction} summarization {Summary} rewriting {Rewriting} generation {Writing / generation} code {Code} reasoning {Multi-step reasoning} conversation {Conversation} other {Undetermined}}',
    taskRationaleTranslation:
      'Translation is the task best served by small models: the meaning is in the source, not in the reasoning.',
    taskRationaleClassification: 'Picking a label from a closed list does not require multi-step reasoning.',
    taskRationaleExtraction:
      'Finding fields in a text: the difficulty is the output format, not intelligence.',
    taskRationaleSummarization:
      'A faithful summary is within reach of small models; context length matters more than the tier.',
    taskRationaleRewriting: 'Rephrasing to a given instruction remains a surface transformation.',
    taskRationaleGeneration:
      'Writing for an external reader is judged on style: the intermediate tier is the first one that holds up.',
    taskRationaleConversation:
      'A multi-turn exchange must keep track; that is where light models fall behind.',
    taskRationaleCode: 'Wrong code costs more than the model saved.',
    taskRationaleReasoning: 'Chaining deductions is exactly what these models exist for.',
    taskRationaleUnknown:
      'Unclassified task: no downgrade is proposed, since we do not know what is at stake.',

    makeUnnamedModule: 'Module #{id} ({label}) has no name: name it after what it does',
    makeDuplicateModules: 'Identical modules (type + settings): {names} — can they be factored?',
    makeRenameUnreadable: "Content unreadable as a Make blueprint (no 'flow'): nothing is renamed.",
    makeRenameUnknownModules: 'Modules not found in the scenario: {ids}',
    makeRenameEmptyName: 'Empty name for module #{id}',
    makeRenameNeedsId: 'A Make module is renamed by its id: missing for {names}',
    makeScenarioGone: '"{name}" no longer exists in Make: nothing is renamed.',

    aiNotUnderstood: 'The AI did not understand this workflow: {summary}',

    jsSyntaxError: 'Syntax error: {error}',
    jsSyntaxErrorFix: 'The node cannot run: fix the syntax before anything else.',
    jsNoReturn: 'No return: the Code node must return items',
    jsNoReturnFixEach: 'End with {snippet} (one item).',
    jsNoReturnFixAll: 'End with {snippet} (an array of items).',
    jsJsonInAllItems:
      '$json used in "Run Once for All Items" mode: only the first item will be read ($input.all() expected?)',
    jsJsonInAllItemsFix:
      'Loop over the items: {snippet} — or switch the node back to "Run Once for Each Item" if a single item is expected.',
    jsAllInEachItem: '$input.all() is unavailable in "Run Once for Each Item" mode',
    jsAllInEachItemFix:
      'In "each item" mode, use `$json` (the current item) — or switch the node back to "Run Once for All Items" if you need all the items.',
    jsRequire:
      'require(): depends on NODE_FUNCTION_ALLOW_EXTERNAL/BUILTIN on the instance — may fail in prod',
    jsRequireFix:
      'Check that the module is allowed on the target instance, or replace it with a dedicated node (HTTP Request, Crypto…).',

    namingDefault: '"{name}" has a default name: rename it after what it does',
    namingDuplicates: 'Identical nodes (type + parameters): {names} — can they be factored?',
    renameDuplicates: 'Duplicate names after renaming: {names}',

    stickyUncovered: '{count, plural, one {# node} other {# nodes}} outside any sticky zone: {names}',
    stickyEmptyZone: 'Sticky "{name}" covers no node',
    stickyMissingContent:
      'Sticky "{name}" covers {count, plural, one {# node} other {# nodes}} without documenting them',
    stickyOversized:
      'Sticky "{name}" is much larger than the zone of its {count, plural, one {# node} other {# nodes}}',
    stickyColorClash: 'Sticky "{name}" has the same colour as its parent zone "{parent}"',
    stickyOverlap: 'Stickies "{a}" and "{b}" overlap without nesting',

    remoteNoCredential: 'the node carries no credential',
    remoteAllReadsFailed: 'all reads failed',
    remoteProbeFailed: 'n8n probe failed: {error}',
    remoteColumnsOf: 'columns of {table}',

    organizerAiRequired: 'Organizer module: ANTHROPIC_API_KEY required',
    docUnreadableBlueprint: '"{name}": content unreadable as a Make blueprint, nothing to document.',

    profileNoGroup: 'This workflow belongs to no group',
    profileNotFound: 'Profile {id} not found',
    profileWorkflowNotFound: 'Workflow {id} not found',
    scopeGlobal: 'the whole application',
    scopeInstance: 'instance {name}',
    scopeInstanceDeleted: 'instance (deleted)',
    scopeGroup: 'group {name}',
    scopeGroupDeleted: 'group (deleted)',
    scopeFamily: 'workflow {name} (all its envs)',
    scopeFamilyDeleted: 'workflow (deleted)',

    catalogSyncRunning: 'A catalog synchronisation is already running.',
    catalogUpstreamEmpty:
      'The upstream returned no node type: import abandoned, the catalog in database is kept.',
    instanceNotFound: 'Instance not found',
    instanceNoN8nAccount:
      'Instance "{name}" has no n8n account saved. Node types are not served by the public API: fill in an account on the instance page, or stay on the shared catalog.',
    nodeTypeNotInCatalog: 'Type "{type}" missing from the catalog',
    packageMissing: 'Missing package',
    packageNoDoc: 'No doc for "{name}"',
    packageNameMissing: 'Missing package name',
    packagePageUnreadable: 'Unreadable page: {error}',
    packagePasteTextOrUrl: 'Paste a text or an address',

    modelPatternRequired: 'The model pattern is required',
    modelPricesInvalid: 'Invalid prices: USD per million tokens, positive',
    proposalRevision: 'revision {revision}',
    proposalAiComplement: 'complement from the active model',
  },
  {
    moduleVerifierName: 'Vérification',
    moduleVerifierDescription: 'Vérification structurelle, fiabilité et revue logique IA',
    moduleJsCheckerName: 'Vérification JS',
    moduleJsCheckerDescription: 'Analyse des nœuds Code : syntaxe, heuristiques, revue IA',
    moduleFieldCheckerName: 'Champs vs exécutions',
    moduleFieldCheckerDescription: 'Champs référencés confrontés aux exécutions réelles',
    moduleOptimizerName: 'Optimisation',
    moduleOptimizerDescription: 'Naming, nœuds inutiles et renommage sûr',
    moduleRemoteSchemaName: 'Tables distantes',
    moduleRemoteSchemaDescription: 'Colonnes des tables distantes attendues par les workflows',
    moduleOrganizerName: 'Organisation',
    moduleOrganizerDescription: 'Plan de rangement et de naming des workflows (IA)',
    moduleDocSchemaName: 'Documentation',
    moduleDocSchemaDescription: "Schéma Mermaid et résumé IA d'un workflow",
    moduleModelAuditName: 'Audit des modèles IA',
    moduleModelAuditDescription: 'Aptitudes, cycle de vie et coût des modèles LLM',

    quoted: '« {name} »',

    auditFloatingAlias: 'Le modèle « {model} » est un alias flottant : il change sans que le workflow bouge.',
    auditFloatingAliasFix:
      'Épingler une version datée, pour que le comportement du workflow soit décidé ici.',
    auditUnknown: 'Le modèle « {model} » est absent du catalogue : ni tarif ni jugement possibles.',
    auditUnknownFix:
      'Ajouter sa ligne dans le catalogue des modèles pour que coûts et audit le prennent en compte.',
    auditOversized:
      '« {pattern} » est un modèle de raisonnement, et rien ici ne demande d’outils, d’images ni de long contexte.',
    auditOversizedFix:
      'Vérifier qu’un modèle plus léger ne suffirait pas : le raisonnement se paie à chaque appel.',
    auditMissingVision: 'Une image est envoyée à « {pattern} », qui ne sait pas la lire.',
    auditMissingVisionFix:
      'Choisir un modèle qui accepte les images, ou retirer l’entrée image de la chaîne.',
    auditMissingTools:
      'L’agent porte des outils mais « {pattern} » ne sait pas les appeler : il tournera sans jamais en utiliser un.',
    auditMissingToolsFix: 'Choisir un modèle qui gère l’appel d’outils.',
    auditMissingStructured:
      'Un parser structuré est branché derrière « {pattern} », qui ne garantit pas la forme de sa sortie.',
    auditMissingStructuredFix:
      'Choisir un modèle à sortie contrainte, ou accepter le repli sur un parsing best-effort.',
    auditContextTooSmall:
      'Les entrées mesurées (p95 : {p95, number} tokens) frôlent la fenêtre de « {pattern} » ({window, number}).',
    auditContextTooSmallFix:
      'Passer à un modèle à fenêtre plus large, ou réduire ce qui est injecté dans le prompt.',
    auditRetired:
      '« {pattern} » est retiré : l’appel échoue, ou échouera au prochain passage.{hasSuccessor, select, true { Successeur annoncé : {successor}.} other {}}',
    auditSwitchTo: 'Basculer vers {pattern}.',
    auditRetiredFixNoSuccessor: 'Choisir un modèle encore servi par le provider.',
    auditDeprecated:
      '« {pattern} » est déprécié.{hasDeadline, select, true { Retrait annoncé le {deadline}.} other {}}{hasSuccessor, select, true { Successeur annoncé : {successor}.} other {}}',
    auditDeprecatedFix: 'Basculer vers {pattern} avant l’échéance.',
    auditDeprecatedFixNoSuccessor: 'Prévoir la bascule avant le retrait.',
    auditTaskLabel:
      '{task, select, translation {Traduction} classification {Classification} extraction {Extraction de données} summarization {Résumé} rewriting {Réécriture} generation {Rédaction} code {Code} reasoning {Raisonnement} conversation {Conversation} other {{task}}}',
    auditTaskOversized:
      '{label} : un modèle plus léger suffit. {current} → {candidate}, −{pct} % sur le tarif{hasAnnual, select, true {, ~{annual} $/an aux volumes mesurés} other {}}. À vérifier sur un cas de test avant bascule.',
    auditTaskOversizedFix:
      'Basculer vers {candidate}, puis rejouer un cas de test : une descente de gamme change la sortie, elle ne se pose pas à l’aveugle.',
    auditCheaperProvider:
      'Chez un autre provider, {candidate} ({provider}) rend le même service pour −{pct} %{hasAnnual, select, true {, ~{annual} $/an aux volumes mesurés} other {}}.',
    auditCheaperSame:
      '{candidate} a les mêmes aptitudes et le même niveau pour −{pct} %{hasAnnual, select, true {, ~{annual} $/an aux volumes mesurés} other {}}.',
    auditCheaperProviderFix:
      'Changer de provider est un autre nœud, une autre credential et un prompt à recaler : à évaluer, pas à appliquer d’un clic.',
    auditCheaperSameFix: 'Basculer vers {candidate} : niveau et aptitudes conservés.',
    unknownProvider: 'inconnu',

    taskLabel:
      '{task, select, translation {Traduction} classification {Classification} extraction {Extraction de données} summarization {Résumé} rewriting {Réécriture} generation {Rédaction / génération} code {Code} reasoning {Raisonnement en plusieurs étapes} conversation {Conversation} other {Indéterminée}}',
    taskRationaleTranslation:
      'La traduction est la tâche la mieux servie par les petits modèles : le sens est dans la source, pas dans le raisonnement.',
    taskRationaleClassification:
      'Choisir une étiquette dans une liste fermée ne demande pas de raisonnement en plusieurs étapes.',
    taskRationaleExtraction:
      "Retrouver des champs dans un texte : la difficulté est le format de sortie, pas l'intelligence.",
    taskRationaleSummarization:
      'Un résumé fidèle est à la portée des petits modèles ; la longueur du contexte compte davantage que le tier.',
    taskRationaleRewriting: 'Reformuler à consigne donnée reste une transformation de surface.',
    taskRationaleGeneration:
      'La rédaction pour un lecteur externe se juge sur le style : le tier intermédiaire est le premier qui tienne.',
    taskRationaleConversation:
      "Un échange multi-tours doit tenir le fil ; c'est là que les modèles légers décrochent.",
    taskRationaleCode: 'Du code faux coûte plus cher que le modèle économisé.',
    taskRationaleReasoning: 'Enchaîner des déductions est exactement ce pour quoi ces modèles existent.',
    taskRationaleUnknown:
      'Tâche non classée : on ne propose aucune descente de gamme, faute de savoir ce qui se joue.',

    makeUnnamedModule: "Le module #{id} ({label}) n'a pas de nom : nomme-le d'après ce qu'il fait",
    makeDuplicateModules: 'Modules identiques (type + réglages) : {names} — factorisables ?',
    makeRenameUnreadable: "Contenu illisible comme blueprint Make (aucun 'flow') : rien n'est renommé.",
    makeRenameUnknownModules: 'Modules introuvables dans le scénario : {ids}',
    makeRenameEmptyName: 'Nom vide pour le module #{id}',
    makeRenameNeedsId: 'Un module Make se renomme par son id : absent pour {names}',
    makeScenarioGone: "« {name} » n'existe plus dans Make : rien n'est renommé.",

    aiNotUnderstood: "L'IA n'a pas compris ce workflow : {summary}",

    jsSyntaxError: 'Erreur de syntaxe : {error}',
    jsSyntaxErrorFix: 'Le nœud ne peut pas s’exécuter : corrige la syntaxe avant tout le reste.',
    jsNoReturn: 'Aucun return : le nœud Code doit retourner des items',
    jsNoReturnFixEach: 'Termine par {snippet} (un item).',
    jsNoReturnFixAll: 'Termine par {snippet} (un tableau d’items).',
    jsJsonInAllItems:
      '$json utilisé en mode "Run Once for All Items" : seul le premier item sera lu ($input.all() attendu ?)',
    jsJsonInAllItemsFix:
      'Boucle sur les items : {snippet} — ou repasse le nœud en "Run Once for Each Item" si un seul item est attendu.',
    jsAllInEachItem: '$input.all() en mode "Run Once for Each Item" est indisponible',
    jsAllInEachItemFix:
      'En mode "each item", utilise `$json` (l’item courant) — ou repasse le nœud en "Run Once for All Items" si tu as besoin de tous les items.',
    jsRequire:
      "require() : dépend de NODE_FUNCTION_ALLOW_EXTERNAL/BUILTIN sur l'instance — peut échouer en prod",
    jsRequireFix:
      'Vérifie que le module est autorisé sur l’instance cible, ou remplace-le par un nœud dédié (HTTP Request, Crypto…).',

    namingDefault: '"{name}" a un nom par défaut : renomme-le d\'après ce qu\'il fait',
    namingDuplicates: 'Nœuds identiques (type + paramètres) : {names} — factorisables ?',
    renameDuplicates: 'Noms en double après renommage : {names}',

    stickyUncovered: '{count} nœud(s) hors de toute zone sticky : {names}',
    stickyEmptyZone: 'La sticky "{name}" ne couvre aucun nœud',
    stickyMissingContent: 'La sticky "{name}" couvre {count} nœud(s) sans les documenter',
    stickyOversized: 'La sticky "{name}" est bien plus grande que la zone de ses {count} nœud(s)',
    stickyColorClash: 'La sticky "{name}" a la même couleur que sa zone parente "{parent}"',
    stickyOverlap: 'Les stickies "{a}" et "{b}" se chevauchent sans s\'imbriquer',

    remoteNoCredential: 'le nœud ne porte aucune credential',
    remoteAllReadsFailed: 'toutes les lectures ont échoué',
    remoteProbeFailed: 'sonde n8n en échec : {error}',
    remoteColumnsOf: 'colonnes de {table}',

    organizerAiRequired: 'Module organizer : ANTHROPIC_API_KEY requis',
    docUnreadableBlueprint: '« {name} » : contenu illisible comme blueprint Make, rien à documenter.',

    profileNoGroup: 'Ce workflow n’appartient à aucun groupe',
    profileNotFound: 'Profil {id} introuvable',
    profileWorkflowNotFound: 'Workflow {id} introuvable',
    scopeGlobal: 'toute l’application',
    scopeInstance: 'instance {name}',
    scopeInstanceDeleted: 'instance (supprimée)',
    scopeGroup: 'groupe {name}',
    scopeGroupDeleted: 'groupe (supprimé)',
    scopeFamily: 'workflow {name} (tous ses envs)',
    scopeFamilyDeleted: 'workflow (supprimé)',

    catalogSyncRunning: 'Une synchronisation du catalogue est déjà en cours.',
    catalogUpstreamEmpty:
      "L'amont n'a rendu aucun type de nœud : import abandonné, le catalogue en base est conservé.",
    instanceNotFound: 'Instance introuvable',
    instanceNoN8nAccount:
      "L'instance « {name} » n'a pas de compte n8n enregistré. Les types de nœuds ne sont pas servis par l'API publique : renseigne un compte dans la fiche de l'instance, ou reste sur le catalogue mutualisé.",
    nodeTypeNotInCatalog: 'Type « {type} » absent du catalogue',
    packageMissing: 'Paquet manquant',
    packageNoDoc: 'Aucune doc pour « {name} »',
    packageNameMissing: 'Nom de paquet manquant',
    packagePageUnreadable: 'Page illisible : {error}',
    packagePasteTextOrUrl: 'Colle un texte ou une adresse',

    modelPatternRequired: 'Le motif de modèle est requis',
    modelPricesInvalid: 'Tarifs invalides : USD par million de tokens, positifs',
    proposalRevision: 'révision {revision}',
    proposalAiComplement: 'complément du modèle actif',
  },
);
