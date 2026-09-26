import { defineMessages } from '../catalog';

/** Modifications proposées (n8n et Make), leur porte, leur explication en clair et leur résumé. */
export const edit = defineMessages(
  {
    clauseSeparator: '; ',

    // Opérations d'édition n8n (workflow-edit.ts)
    nodeNotFound: 'Node "{name}" not found in the workflow',
    emptyParamPath: 'Empty parameter path',
    paramNotFound: 'Parameter not found: {path}',
    emptyWorkflowName: 'Empty workflow name',
    emptyNodeName: 'Empty new node name',
    nodeExists: 'A node named "{name}" already exists',
    invalidParams: 'Invalid parameters for "{name}"',
    newNodeRequires: 'A new node requires at least a `name` and a `type`',
    unknownOperation: 'Unknown operation: {hasOp, select, true {{op}} other {(no op)}}',
    duplicateNames: 'Duplicate node names: {names}',
    operationFailed: 'Operation {index} ({op}): {message}',
    noOperations: 'No operation to apply',
    danglingIntroduced: 'Connection {side, select, from {from} other {to}} a missing node: {name}',
    warnNoTrigger: 'The workflow no longer has a trigger node: it will not be able to start.',
    warnMassLoss:
      '"{name}" loses {lost} parameters: if you meant to remove only one, use `remove-node-parameter` instead of sending back the whole block.',
    warnOrphans: 'Node(s) added without a connection: {names}.',
    warnPruned: 'Dangling connection(s) cleaned up: {names} (node missing from the workflow).',

    // Intégrité (workflow-integrity.ts)
    breachNoNodes: 'The change empties the workflow: no node would be left.',
    breachTriggerLost: 'The change removes the last trigger node: the workflow could no longer start.',
    breachUntyped: 'Node(s) without a name or type, which n8n will not be able to run: {names}.',
    breachDangling: 'Connection(s) to a node missing from the workflow: {names}.',
    unnamedNode: '(unnamed node)',

    // Porte (proposal-gate.ts)
    gateIntegrity:
      'Change refused: it breaks the workflow. {details} This refusal cannot be overridden — rephrase the request in the conversation.',
    gateRefusal:
      'n8n will refuse to save this workflow, not just this change: {detail} Fix it in the conversation — the same request will then go through.',
    gateForced: '{count} problem(s) introduced, applied despite the refusal: {detail}',
    gateQuality:
      'Change refused on this {prod, select, true {production } other {}}workflow: it introduces {count} error(s) — {detail}. Fix them in the conversation, or tick "Apply anyway".',

    // Ce que change une modification (change-impact.ts)
    valueEmpty: 'empty',
    cronDay:
      '{day, select, sun {Sunday} mon {Monday} tue {Tuesday} wed {Wednesday} thu {Thursday} fri {Friday} sat {Saturday} other {?}}',
    cronEveryDay: 'every day',
    cronDayRange: '{start} to {end}',
    cronOneDay: 'on {day}',
    cronDayList: 'on {first} and {last}',
    cronAt: '{days} at {time}',
    cronMonthly: 'on day {day} of every month at {time}',
    triggerChange: 'Trigger: {from} → {to}',
    triggerSet: 'Trigger: {to} (before: {before})',
    paramAdded: 'New parameter "{field}" = {value}',
    paramRemoved: 'Parameter "{field}" removed (was {value})',
    paramChanged: '"{field}": {from} → {to}',
    noCredential: 'none',
    cappedMore: '… and {rest} {what, select, links {other link(s) affected} other {other field(s) changed}}',
    nodeAdded: 'New node "{name}" ({type})',
    nodeRemoved: 'Node "{name}" deleted: what it did will no longer be done',
    nodeRenamed: 'Renamed "{from}" → "{to}": any $(\'\'{from}\'\') expression must target the new name',
    nodeDisabled: 'Node disabled: it will no longer run, the flow skips over it',
    nodeEnabled: 'Node re-enabled: it will run again',
    typeChanged: 'Type changes: {from} → {to}',
    credentialChanged: 'Credential changes: {from} → {to}',
    errorHandlingChanged: "Changes the node's error handling (retry / continue on failure)",
    massLoss:
      'The node loses {lost} parameters at once: check that a whole block (mapping schema, field list) was not rewritten from memory instead of being edited',
    moved: 'Moved on the canvas, no effect on execution',
    outputNumber: 'output {n}',
    edgeAdded: '"{from}" now feeds "{to}"{suffix}',
    edgeRemoved: '"{from}" no longer feeds "{to}"{suffix}',

    // Résumé d'un brouillon (edit-summary.ts)
    summaryRenameWorkflow: 'rename workflow to "{name}"',
    summaryRenameNode: 'rename "{node}" to "{newName}"',
    summaryParameters: 'parameters of "{node}"',
    summaryRemoveParameter: 'removal of a parameter of "{node}"',
    summaryNotes: 'note of "{node}"',
    summaryDisabled: '{disabled, select, true {disabling} other {re-enabling}} of "{node}"',
    summaryRemoveNode: 'deletion of "{node}"',
    summaryAddNode: 'addition of "{name}"',
    summaryNodeFallback: 'node',
    summaryConnect: 'connection {from} → {to}',
    summaryDisconnect: 'disconnection {from} → {to}',
    summaryModification: 'change',
    summaryMore: '{head} (+{count} others)',
    summaryDefault: 'Proposed change',

    // Niveau de version (version-bump.ts)
    bumpRemoved: '{count} node(s) removed ({names}): the workflow no longer does part of what it used to do.',
    bumpTrigger: 'Trigger touched ({names}): the entry point of the workflow changes.',
    bumpRenamed: 'Renamed "{before}" → "{after}": the name is what pairs the copies from one env to another.',
    bumpAdded: '{count} node(s) added ({names}): the workflow does something more.',
    bumpWiring: 'Wiring changed: the data path changes without anything disappearing.',
    bumpSettings: 'Settings adjusted on {count} node(s) ({names}).',
    bumpCosmetic: 'Cosmetic changes only (position, notes, node renaming).',
    bumpIdentical: 'Content identical to the target: the promotion only puts back the same workflow.',

    // Modifications d'un scénario Make (blueprint-edit.ts)
    makeUnreadable: "Content unreadable as a Make blueprint (no 'flow'): nothing is changed.",
    makeNoOperations: 'No operation to apply.',
    makeSummary: 'Scenario: {parts}',
    makeSummaryModified: '{count, plural, one {# module changed} other {# modules changed}}',
    makeSummaryRenamed: '{count, plural, one {# module renamed} other {# modules renamed}}',
    makeSummaryRemoved: '{count, plural, one {# module deleted} other {# modules deleted}}',
    makeOpWhere: 'operation {index}',
    makeOpWhereType: 'operation {index} ({type})',
    makeOpField: '{where}: "{field}"',
    makeOpNoType: '{where}: no "type".',
    makeOpUnknownType:
      '{where}: "{type}" does not exist on a Make scenario. Possible operations: {types}. Adding a module or a route is not possible here.',
    makeOpModuleId: '{where}: "moduleId" must be the integer id of the module.',
    makeOpSection: '{where}: "section" is "mapper" or "parameters".',
    makeOpPath: '{where}: "path" missing (e.g. "headers.0.value").',
    makeOpFilter: '{where}: "filter" is an object, or null to remove it.',
    makeOpName: '{where}: "name" empty.',
    makeFilterRemoved: 'The filter of module #{id} is removed: it will let all bundles through.',
    makeModuleNotFound: 'Module #{id} not found in this scenario.',
    makeRemoveCarries:
      'Deleting module #{id} also removes the {count} module(s) it carries (routes, branches, handlers).',
    makeFieldAbsent: '"{path}" was already absent from module #{id}.',
    makePatchInvalid: '{label} must be a non-empty object — only the given keys change.',
    makeMaskCopied:
      '{label}: a masked value ("{mask}") was copied. The real secret is never shown: don\'t rewrite this field, leave it as is by not putting it in the operation.',
    makeAccountKey:
      '{label}: the "__IMT…__" keys (connection, webhook, account key) cannot be changed here — their value is an id specific to the Make account. Tell the user to choose it in Make.',

    // Revue d'une proposition Make (blueprint-review-diff.ts)
    makeModuleAdded: 'Module added.',
    makeModuleRemoved: 'Module deleted: whatever read its output will no longer receive anything.',
    makeChainChanged: 'The sequence of modules has changed.',
    makeRenamed: 'Renamed to "{name}".',
    makeFilterChanged: "The module's filter has changed: it will no longer let the same bundles through.",
    makeFilterDropped: 'Filter removed: the module will process all bundles.',
  },
  {
    clauseSeparator: ' ; ',

    nodeNotFound: 'Nœud « {name} » introuvable dans le workflow',
    emptyParamPath: 'Chemin de paramètre vide',
    paramNotFound: 'Paramètre introuvable : {path}',
    emptyWorkflowName: 'Nom de workflow vide',
    emptyNodeName: 'Nouveau nom de nœud vide',
    nodeExists: 'Un nœud nommé « {name} » existe déjà',
    invalidParams: 'Paramètres invalides pour « {name} »',
    newNodeRequires: 'Un nouveau nœud exige au moins un `name` et un `type`',
    unknownOperation: 'Opération inconnue : {hasOp, select, true {{op}} other {(sans op)}}',
    duplicateNames: 'Noms de nœuds en double : {names}',
    operationFailed: 'Opération {index} ({op}) : {message}',
    noOperations: 'Aucune opération à appliquer',
    danglingIntroduced: 'Connexion {side, select, from {depuis} other {vers}} un nœud inexistant : {name}',
    warnNoTrigger: "Le workflow n'a plus de nœud déclencheur : il ne pourra plus démarrer.",
    warnMassLoss:
      "« {name} » perd {lost} paramètres : si tu voulais n'en retirer qu'un, utilise `remove-node-parameter` plutôt que de renvoyer le bloc entier.",
    warnOrphans: 'Nœud(s) ajouté(s) sans connexion : {names}.',
    warnPruned: 'Connexion(s) pendante(s) nettoyée(s) : {names} (nœud absent du workflow).',

    breachNoNodes: 'La modification vide le workflow : il ne resterait aucun nœud.',
    breachTriggerLost:
      'La modification retire le dernier nœud déclencheur : le workflow ne pourrait plus démarrer.',
    breachUntyped: 'Nœud(s) sans nom ou sans type, que n8n ne saura pas exécuter : {names}.',
    breachDangling: 'Connexion(s) vers un nœud absent du workflow : {names}.',
    unnamedNode: '(nœud sans nom)',

    gateIntegrity:
      'Modification refusée : elle casse le workflow. {details} Ce refus-là ne se contourne pas — reformule la demande dans la conversation.',
    gateRefusal:
      "n8n refusera d'enregistrer ce workflow, et pas seulement cette modification : {detail} Corrige-le dans la conversation — la même demande passera ensuite.",
    gateForced: '{count} problème(s) introduit(s), appliqués malgré le refus : {detail}',
    gateQuality:
      'Modification refusée sur ce workflow{prod, select, true { de production} other {}} : elle introduit {count} erreur(s) — {detail}. Corrige-les dans la conversation, ou coche « appliquer quand même ».',

    valueEmpty: 'vide',
    cronDay:
      '{day, select, sun {dimanche} mon {lundi} tue {mardi} wed {mercredi} thu {jeudi} fri {vendredi} sat {samedi} other {?}}',
    cronEveryDay: 'tous les jours',
    cronDayRange: 'du {start} au {end}',
    cronOneDay: 'le {day}',
    cronDayList: 'le {first} et {last}',
    cronAt: '{days} à {time}',
    cronMonthly: 'le {day} de chaque mois à {time}',
    triggerChange: 'Déclenchement : {from} → {to}',
    triggerSet: 'Déclenchement : {to} (avant : {before})',
    paramAdded: 'Nouveau paramètre « {field} » = {value}',
    paramRemoved: 'Paramètre « {field} » retiré (valait {value})',
    paramChanged: '« {field} » : {from} → {to}',
    noCredential: 'aucun',
    cappedMore:
      '… et {rest} {what, select, links {autre(s) lien(s) touché(s)} other {autre(s) champ(s) modifié(s)}}',
    nodeAdded: 'Nouveau nœud « {name} » ({type})',
    nodeRemoved: "Nœud « {name} » supprimé : ce qu'il faisait ne sera plus fait",
    nodeRenamed: "Renommé « {from} » → « {to} » : toute expression $(''{from}'') doit viser le nouveau nom",
    nodeDisabled: "Nœud désactivé : il ne s'exécutera plus, le flux passe par-dessus",
    nodeEnabled: "Nœud réactivé : il s'exécutera de nouveau",
    typeChanged: 'Change de type : {from} → {to}',
    credentialChanged: 'Change de credential : {from} → {to}',
    errorHandlingChanged: "Change la gestion d'erreur du nœud (retry / suite en cas d'échec)",
    massLoss:
      "Le nœud perd {lost} paramètres d'un coup : vérifie qu'un bloc entier n'a pas été réécrit de mémoire (schéma de mapping, liste de champs) au lieu d'être retouché",
    moved: "Déplacement sur le canvas, sans effet sur l'exécution",
    outputNumber: 'sortie {n}',
    edgeAdded: '« {from} » alimente désormais « {to} »{suffix}',
    edgeRemoved: "« {from} » n'alimente plus « {to} »{suffix}",

    summaryRenameWorkflow: 'renommage du workflow en « {name} »',
    summaryRenameNode: 'renommage de « {node} » en « {newName} »',
    summaryParameters: 'paramètres de « {node} »',
    summaryRemoveParameter: "retrait d'un paramètre de « {node} »",
    summaryNotes: 'note de « {node} »',
    summaryDisabled: '{disabled, select, true {désactivation} other {réactivation}} de « {node} »',
    summaryRemoveNode: 'suppression de « {node} »',
    summaryAddNode: 'ajout de « {name} »',
    summaryNodeFallback: 'nœud',
    summaryConnect: 'connexion {from} → {to}',
    summaryDisconnect: 'déconnexion {from} → {to}',
    summaryModification: 'modification',
    summaryMore: '{head} (+{count} autres)',
    summaryDefault: 'Modification proposée',

    bumpRemoved:
      "{count} nœud(s) retiré(s) ({names}) : le workflow ne fait plus une partie de ce qu'il faisait.",
    bumpTrigger: "Déclencheur touché ({names}) : c'est le point d'entrée du workflow qui change.",
    bumpRenamed:
      "Renommé « {before} » → « {after} » : c'est le nom qui apparie les exemplaires d'un env à l'autre.",
    bumpAdded: '{count} nœud(s) ajouté(s) ({names}) : le workflow fait quelque chose de plus.',
    bumpWiring: 'Câblage modifié : le chemin des données change sans que rien ne disparaisse.',
    bumpSettings: 'Réglages ajustés sur {count} nœud(s) ({names}).',
    bumpCosmetic: 'Changements de forme seulement (position, notes, renommage de nœud).',
    bumpIdentical: 'Contenu identique à la cible : la promotion ne fait que reposer le même workflow.',

    makeUnreadable: "Contenu illisible comme blueprint Make (aucun 'flow') : rien n'est modifié.",
    makeNoOperations: 'Aucune opération à appliquer.',
    makeSummary: 'Scénario : {parts}',
    makeSummaryModified: '{count, plural, one {# module modifié} other {# modules modifiés}}',
    makeSummaryRenamed: '{count, plural, one {# module renommé} other {# modules renommés}}',
    makeSummaryRemoved: '{count, plural, one {# module supprimé} other {# modules supprimés}}',
    makeOpWhere: 'opération {index}',
    makeOpWhereType: 'opération {index} ({type})',
    makeOpField: '{where} : « {field} »',
    makeOpNoType: '{where} : sans « type ».',
    makeOpUnknownType:
      "{where} : « {type} » n'existe pas sur un scénario Make. Opérations possibles : {types}. Ajouter un module ou une route n'est pas possible ici.",
    makeOpModuleId: "{where} : « moduleId » doit être l'id entier du module.",
    makeOpSection: '{where} : « section » vaut "mapper" ou "parameters".',
    makeOpPath: '{where} : « path » manquant (ex. "headers.0.value").',
    makeOpFilter: '{where} : « filter » est un objet, ou null pour le retirer.',
    makeOpName: '{where} : « name » vide.',
    makeFilterRemoved: 'Le filtre du module #{id} est retiré : il laissera passer tous les bundles.',
    makeModuleNotFound: 'Module #{id} introuvable dans ce scénario.',
    makeRemoveCarries:
      "Supprimer le module #{id} retire aussi les {count} module(s) qu'il porte (routes, branches, gestionnaires).",
    makeFieldAbsent: '« {path} » était déjà absent du module #{id}.',
    makePatchInvalid: '{label} doit être un objet non vide — seules les clés données changent.',
    makeMaskCopied:
      "{label} : une valeur masquée (« {mask} ») a été recopiée. Le vrai secret n'est jamais montré : ne réécris pas ce champ, laisse-le tel quel en ne le mettant pas dans l'opération.",
    makeAccountKey:
      "{label} : les clés « __IMT…__ » (connexion, webhook, clé du compte) ne se modifient pas ici — leur valeur est un id propre au compte Make. Dis à l'utilisateur de la choisir dans Make.",

    makeModuleAdded: 'Module ajouté.',
    makeModuleRemoved: 'Module supprimé : ce qui lisait sa sortie ne recevra plus rien.',
    makeChainChanged: "L'enchaînement des modules a changé.",
    makeRenamed: 'Renommé en « {name} ».',
    makeFilterChanged: 'Le filtre du module a changé : il ne laissera plus passer les mêmes bundles.',
    makeFilterDropped: 'Filtre retiré : le module traitera tous les bundles.',
  },
);
