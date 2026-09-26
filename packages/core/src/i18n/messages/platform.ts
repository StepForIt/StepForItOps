import { defineMessages } from '../catalog';

/** Plateforme : tests, versions, miroir des workflows, instances, config, découverte, carte, réglages, adapters. */
export const platform = defineMessages(
  {
    // test-snapshot
    snapKindValue: '{count, plural, one {# different value} other {# different values}}',
    snapKindType: '{count, plural, one {# different type} other {# different types}}',
    snapKindMissing: '{count, plural, one {# field gone} other {# fields gone}}',
    snapKindExtra: '{count, plural, one {# extra field} other {# extra fields}}',
    snapKindCount: '{count, plural, one {# list of different size} other {# lists of different size}}',
    snapKindNormalization: '{count, plural, one {# comparison artifact} other {# comparison artifacts}}',
    snapMatch: 'Output matches the reference.',
    snapSummary: '{count, plural, one {# difference} other {# differences}} with the reference: {parts}.',
    snapElement: 'item {rank}',
    snapTypeName:
      '{type, select, list {list} string {text} number {number} boolean {boolean} object {object} other {nothing}}',
    snapDiffCount: '{field}: the replay produced {actual} item(s) where the reference had {expected}.',
    snapDiffMissing: '{field}: the field is no longer produced by the replay (the reference had {before}).',
    snapDiffExtra: '{field}: the replay produces a field the reference did not have ({after}).',
    snapDiffNormalization:
      '{field}: variable part (id, date, url…) recognized on one side only — {before} versus {after}. It is the comparison that stumbles, not the data: re-record the test case if the difference persists.',
    snapDiffType: '{field}: {actualType} {after} where the reference had {expectedType} {before}.',
    snapDiffValue: '{field}: the replay produced {after}, the reference said {before}.',
    // node-bench
    benchInputName: 'Bench input',
    benchNodeMissing: 'Node “{nodeName}” is not in the workflow',
    benchIssueSticky: 'A note executes nothing.',
    benchIssueTrigger: 'A trigger produces the input: there is nothing to feed or isolate.',
    benchIssueDisabled: 'Node disabled in the original workflow: the bench runs it anyway.',
    benchIssueBinary: 'This node expects a file as input: a JSON sample does not rebuild it.',
    benchIssueMissingRef:
      'The expression cites “{ref}”, which does not exist in the workflow: the bench will add it under that name.',
    benchIssueSubNodes: 'Sub-nodes copied and ACTUALLY executed: {nodes}.',
    benchFeedExpression: 'Simulated: cited by an expression of the tested node.',
    benchFeedInput: 'Simulated: feeds the input of the tested node.',
    benchImpossible: 'Bench impossible for “{nodeName}”: {reason}',
    benchNotTestable: 'node not testable',
    benchStartNode: 'Start the bench',
    benchResultNode: 'Return the result',
    benchStartNotes: 'Test bench for node “{nodeName}” (workflow “{workflowName}”). Set up by the platform.',
    benchReadOnly: 'reads or transforms, without sending anything out of the system',
    benchGateForced: 'Explicit override: run despite production.',
    benchGateProduction: 'Production workflow: switch the resources to a dev env, or tick the override.',
    benchNotRun: 'The node was not executed by the bench.',
    // stub-workflow
    stubTriggerNode: 'Call received',
    stubEchoNode: 'Return the input',
    stubNotes: 'Stub of “{subWorkflowName}”: set up by the platform for a test. Nothing is executed here.',
    // side-effect-nodes
    sideEffectEmail: 'sends an email',
    sideEffectMessage: 'posts a message',
    sideEffectSubWorkflow: 'runs another workflow',
    sideEffectHttp: 'HTTP call {method}',
    sideEffectDataWrite: 'writes data ({operation})',
    // blank-workflow
    blankTriggerName: 'When clicking ‘Execute workflow’',
    // ai.port
    aiToolLoopInterrupted:
      'Tool loop interrupted after {rounds} rounds without a final answer{hasTools, select, true { ({tools})} other {}}',
    // time-saved
    timeSavedWrite: '{count, plural, one {# write} other {# writes}}',
    timeSavedSend: '{count, plural, one {# send} other {# sends}}',
    timeSavedRead: '{count, plural, one {# read} other {# reads}}',
    timeSavedThink: '{count, plural, one {# AI pass} other {# AI passes}}',
    timeSavedDecide: '{count, plural, one {# decision} other {# decisions}}',
    timeSavedTransform: '{count, plural, one {# formatting} other {# formattings}}',
    timeSavedNone:
      'No replaced human gesture was recognized: the workflow is only wiring, or its nodes are disabled.',
    timeSavedCapped:
      '{detail} — capped at {max} min: beyond that, the estimate would only reflect the size of the workflow.',
    // resource-fields
    columnUnknownShape: 'node shape not recognized: open it to check',
    columnNoFields: 'this node neither selects nor writes fields',
    columnAutoMap: 'automatic mapping: the node writes the fields it receives',
    columnAllRead: 'no selection: the node returns every column',
    columnAlreadyMapped: 'column already mapped',
    columnAlreadySelected: 'column already selected',
    columnFixedMapping:
      'mapping fixed on {count, plural, one {# field} other {# fields}}: the column will not be written',
    columnFixedSelection:
      '{count, plural, one {# field selected} other {# fields selected}}: the column will not be returned',
    // workflow-actions
    actionMakeNoPinData:
      'Make has no equivalent of pinned data: a module cannot be stubbed without rewriting the scenario.',
    actionMakeNoExecutionData:
      'Make does not return the data produced by an execution — only failed executions keep some. So there is nothing to compare with the expressions.',
    actionMakeEnvSwitchNotYet: 'Resource switching and promotion are not yet ported to Make.',
    actionMakeRemoteSchemaNotYet:
      'The remote tables check reads n8n nodes: it is not yet ported to Make modules.',
    actionMakeNoPublish:
      'Make does not separate draft and published version: a scenario is active or it is not.',
    // make domain
    makeTokenMalformed: '{base}. The token is malformed or missing.',
    makeNotAuthorized:
      '{base}. Either the token lacks the requested permission, or it belongs to a zone other than {zone} — both give this same refusal.',
    makeRateLimited: "{base}. The organization's call limit has been reached.",
    makeBlueprintResponseUnreadable: "Unreadable Make blueprint response: no 'response.blueprint'.",
    makeBlueprintUnreadableWrite: "Content unreadable as a Make blueprint (no 'flow'): nothing is written.",
    makeBlueprintUnreadableExport: "Content unreadable as a Make blueprint (no 'flow'): nothing to export.",
    makeScenarioEmpty: 'Scenario without modules',
    // adapters
    aiNoKey: 'No AI API key: AI settings or {envVar}',
    aiNotConfigured: 'AiPort not configured: fill in the AI settings or {envVar}',
    aiRefused: "The AI request was refused by the model's safeguards",
    aiTruncatedAnthropic:
      'Truncated AI response: budget of {maxTokens} tokens reached (reasoning included) — increase maxTokens or lower the effort',
    aiTruncatedMistral:
      'Truncated AI response: budget of {maxTokens} tokens reached — increase maxTokens or shorten the context',
    aiEmptyMistral: 'Empty AI response: no choice returned by Mistral',
    n8nNoAccount:
      'Instance “{baseUrl}” has no registered n8n account. Node type descriptions are not served by the public API: fill in an account on the instance page, or stay on the shared catalog.',
    n8nLoginRefused:
      'n8n login refused for “{email}” → {status}{rateLimited, select, true { (n8n limits logins to 5 per minute per account)} other {}}: {detail}',
    n8nNoCookie:
      'n8n login accepted but no {cookie} cookie received: MFA is probably required on this account, and the platform cannot get past it.',
    n8nSessionFailed: 'n8n {method} {path}: unable to establish a session',
    webhookTimeout: 'no response within {seconds} s',
    webhookUnreachable: 'Webhook {path} unreachable: {reason}',
    n8nNodeTypesUnexpected: 'types/nodes.json: unexpected format',
    makeNoZone: 'Make instance without a zone: fill in “eu1.make.com”, “eu2.make.com”…',
    makeNoScope: 'Make instance without a scope: fill in the team or organization id.',
    npmRegistryFailed: 'npm registry → {status} for {packageName}',
    docsHttpOnly: 'Only http(s) addresses are accepted',
    docsNoReadme: 'This npm package has no README',
    docsEmptyPage: 'The page contains no text',
    catalogNoSha: 'No sha returned for {path}',
    catalogDownloadFailed: 'Catalog download → {status}',
    catalogSqliteMissing:
      'Unable to read the catalog: `node:sqlite` requires Node 22 or later. The api image must be built on node:22-alpine.',
    litellmRevisionUnavailable: 'LiteLLM revision unavailable (HTTP {status})',
    litellmRevisionUnreadable: 'Unreadable LiteLLM revision: no sha',
    litellmPricesUnavailable: 'LiteLLM prices unavailable (HTTP {status})',
    // tester / test-cases
    testCaseNoWebhook:
      'This workflow exposes no webhook: nothing to replay. Test cases require a webhook trigger.',
    testCaseNoData: 'Execution without usable data (purged by n8n, or without output): pick another one.',
    testCaseDefaultName: 'Like execution {executionId}',
    testCaseNotFound: 'Test case {id} not found',
    testCaseWebhookGone: 'The workflow no longer has a webhook node: there is nothing left to replay.',
    testCaseWebhookNotRegistered:
      'Webhook not registered in n8n: the workflow must be ACTIVE to answer on /webhook/{path}. ({error})',
    testCaseWebhookError: 'The webhook answered with an error: {error}',
    testCaseNoExecution:
      'The webhook answered, but no execution appeared within {seconds} s (execution too long, or not saved by n8n).',
    testCaseNothingTriggered: 'No execution triggered. {cause}',
    testCaseStillRunning:
      'Execution {executionId} was still running after {seconds} s: nothing to compare. Run again once it has finished.',
    testCaseOutputOf: ' (output of node “{node}”)',
    // manifests
    moduleTesterName: 'Tests',
    moduleTesterDescription: 'Workflow tests and stubbed copies',
    moduleVersioningName: 'Versioning',
    moduleVersioningDescription: 'Workflow snapshots and GitHub / Drive export',
    moduleConfigTransferName: 'Configuration export / import',
    moduleConfigTransferDescription: 'JSON export and import of the whole configuration',
    moduleResourceDiscoveryName: 'Resource discovery',
    moduleResourceDiscoveryDescription: 'Lists the real bases and tables through n8n',
    moduleDepGraphName: 'Dependencies',
    moduleDepGraphDescription: 'Workflow map and usage of external resources',
    moduleWorkflowGroupsName: 'Workflow groups',
    moduleWorkflowGroupsDescription: 'Groups workflows by domain, batch operations',
    moduleInstancesName: 'n8n instances',
    moduleInstancesDescription: 'Connection to n8n instances (dev/preprod/prod)',
    moduleModuleAdminName: 'Module administration',
    moduleModuleAdminDescription: 'Enabling / disabling modules',
    moduleWorkflowsName: 'Workflows',
    moduleWorkflowsDescription: 'Local mirror of workflows + synchronization',
    // tester
    benchNotABench: '“{name}” is not a test bench',
    benchUnreachable: 'Bench unreachable',
    benchNoExecution: 'No bench execution found in n8n.',
    mockMappedExemption: 'mapped resource: switch the env rather than stubbing',
    testerNoWebhook: 'This workflow exposes no active Webhook node',
    testerPinLost: 'n8n did not pin {nodes} — the copy would have sent for real, it was deleted.',
    testerCopyCreated: 'Copy created — run it from n8n then bring back the result',
    testerNoExecution: 'No execution found',
    webhookHeldByOther:
      '“{name}” is inactive, but its webhook {method} /{path} is registered by “{holder}”, which is active: the call would have triggered THAT workflow, not this one. Activate “{name}” (n8n will deactivate the other one, the path is unique) or give it its own path.',
    webhookInactive:
      '“{name}” is inactive in n8n: the production webhook /{path} is not registered there and the call would come back as 404. Activate the workflow to replay this case.',
    // versioning
    archiveSweepRunning: 'Exports are already being sorted — wait for it to finish',
    versionNotFound: 'Version {id} not found',
    restoreMakeSchedule:
      'The scenario schedule is not in the blueprint: it stays as it is today, whatever the version had.',
    restoreMakeRefsGone:
      'The version uses {refs}, which the scenario no longer uses today. If one was deleted in Make, the scenario will come back invalid and refuse to activate.',
    restoreMakeRef:
      '{kind, select, connection {the connection} webhook {the webhook} other {{key}}} #{id} ({module})',
    exportAllRunning: 'A global export is already running — wait for it to finish',
    exportNoTarget: 'No active export target — set up GitHub or Drive in “Export targets”',
    exportTargetNotFound: 'Export target {id} not found',
    cleanupTargetNotFound: 'Target {id} not found',
    cleanupNoWorkflow: 'No workflow with this n8n id on the platform — file kept',
    cleanupStaleLocationReady: 'Outdated location: the up-to-date file already exists',
    cleanupStaleLocationReexport: 'Outdated location: re-export this workflow before deleting',
    cleanupUnknownFormat: 'Unknown format, unreadable n8n id — file kept',
    cleanupOldFormatReady: 'Old format: the up-to-date file already exists',
    cleanupOldFormatReexport: 'Old format: re-export this workflow before deleting',
    githubTokenMissing: 'Missing GitHub token (token field or GITHUB_TOKEN)',
    targetTestGithubOnly: 'Test only available for GitHub for now',
    targetTestOwnerRepo: 'owner and repo required',
    versionRestoreMessage: 'Restore of {versionId}',
    exportDriveDestination: 'Google Drive{hasFolder, select, true { (folder {folderId})} other {}} → {path}',
    // workflows
    workflowNotFound: 'Workflow {id} not found',
    divergenceNothingToCompare:
      'Nothing to compare: this copy is itself the reference (prod), or its environment is undetermined.',
    divergenceNoProd: 'No prod copy for this business workflow.',
    divergenceNotComparable: 'Content not comparable: this platform has no deployment fingerprint.',
    archiveNativelyArchived:
      '“{name}” is natively archived in n8n: it can no longer be modified through the API. Unarchive it in n8n first.',
    workflowNotN8n: '“{name}” is served by {platform}: this feature only handles n8n workflows.',
    publishMissing: 'n8n no longer knows this workflow.',
    publishArchived: 'Workflow archived in n8n: publishing is refused.',
    publishDirectModel:
      'This n8n instance does not publish by versions: a workflow there is simply active or not, and writing is enough. There is nothing to publish.',
    publishNoRoute:
      'This n8n instance does not know version publishing (no /publish route): it is too old, or “{name}” has disappeared.',
    publishConflict:
      'n8n refuses to publish “{name}”: either a workflow review is in progress, or a webhook path is already taken by another workflow. What it answers: {detail}',
    publishRefused:
      'n8n refused to publish “{name}” (error {status}). The workflow stays a draft. What it answers: {detail}',
    noDetail: '(no detail)',
    instanceIdExpected: 'instanceId expected',
    minutesExpected: 'minutes: positive number expected',
    findingNotFound: 'Finding {id} not found',
    ignoreRuleNotFound: 'Rule {id} not found',
    workflowNameExpected: 'Workflow name expected',
    viewOutputBranch: 'output {index}',
    unknownType: 'unknown',
    // config-transfer
    importWorkflowMissing:
      '{what}: workflow not found ({instanceUrl} / {externalId}) — sync the workflows from n8n then re-import the same file',
    importSubject:
      '{kind, select, findingIgnore {Finding exclusion "{name}"} group {Group "{name}"} link {Manual link "{name}"} monitor {Monitor "{name}"} other {{name}}}',
    importNoLabel: 'no label',
    importGroupInstanceMissing: 'Group "{name}": instance {instanceUrl} missing from the target',
    configExportDisabled:
      'Configuration export disabled on this installation ({envVar} not set). It only opens locally, where the file does not leave the machine.',
    importInvalidFile: 'Invalid file: this is not a configuration export of the platform',
    importUnsupportedVersion: 'Unsupported bundle version: {version} (expected: {expected})',
    importInstanceNoKey:
      'Instance "{name}" created without apiKey (export without secrets): to be filled in manually',
    importTargetNoSecrets:
      'Export target "{name}" created without its secrets (token…): to be filled in manually',
    importMonitorUnresolved:
      'Monitor "{name}": instance not resolved ({hasRef, select, true {instance {instanceRef} missing from this platform} other {bundle predating the addition of instanceRef}}) — imported disabled, to be re-enabled after choosing its instance',
    importKumaNoPassword:
      'Uptime Kuma settings imported without password (export without secrets): to be filled in manually',
    importAiNoKey: 'AI settings imported without API key (export without secrets): to be filled in manually',
    // instances
    instanceNotFoundAnon: 'Instance not found',
    instanceNotFound: 'Instance {id} not found',
    platformUnsupported: 'Platform “{platform}” not supported by this version.',
    apiKeyRequired: 'API key required',
    apiKeyRequiredForTest: 'API key required to test the connection',
    nameRequired: 'name required',
    // module-admin
    aiKeyRequired: '{provider} API key required',
    aiProviderNoKey: '{provider} has no API key: fill it in before switching (or set {envVar})',
    aiCallFailed: 'AI call failed: {error}',
    aiProviderUnknown: 'Unknown AI provider: {provider}',
    aiProviderAbsent: '(missing)',
    // infra
    probeFailed: '{what} failed: {detail}',
    probeWebhookUnreachable: 'Probe webhook unreachable',
    passwordTooShort: 'Password: {min} characters minimum.',
    alreadyConfigured: 'The platform is already configured.',
    // resource-discovery
    discoveryUnknownStep: 'Unknown step: {provider}/{stepId}',
    discoveryCredentialMismatch: 'Credential {credentialType} incompatible with {provider}',
    discoveryParentRequired: 'Step {stepId} requires a parentId (item of {parentStepId})',
    discoveryHostRequired: '{provider} keeps its API URL in the credential: fill in its host',
    discoveryNotProbe: '{externalId} is not a discovery workflow',
    credentialHostRequired: 'credentialId and host are required',
    instanceIdRequired: 'instanceId is required',
    workflowUnknown: 'Workflow {id} unknown',
    groupUnknown: 'Group {id} unknown',
    untitled: 'untitled',
    // dep-graph
    linkEndsRequired: 'Source and target workflows required',
    linkSelf: 'A workflow cannot link to itself',
    linkUnknownWorkflow: 'Unknown workflow — sync the instance then try again',
    linkDuplicate: 'These two workflows are already linked in this direction',
    linkNotFound: 'Unknown link: {id}',
    mapArchived: 'archived',
    mapUnknownInstance: 'unknown instance',
    keyMissing: 'key missing',
    // workflow-groups
    groupNameInstanceRequired: 'name and instanceId are required',
    makeEdgeRoute: 'route {index}',
    makeEdgeElse: 'else',
    makeEdgeIf: 'if {index}',
  },
  {
    // test-snapshot
    snapKindValue: '{count, plural, one {# valeur différente} other {# valeurs différentes}}',
    snapKindType: '{count, plural, one {# type différent} other {# types différents}}',
    snapKindMissing: '{count, plural, one {# champ disparu} other {# champs disparus}}',
    snapKindExtra: '{count, plural, one {# champ en plus} other {# champs en plus}}',
    snapKindCount:
      '{count, plural, one {# liste de taille différente} other {# listes de taille différente}}',
    snapKindNormalization:
      '{count, plural, one {# artefact de comparaison} other {# artefacts de comparaison}}',
    snapMatch: 'Sortie conforme à la référence.',
    snapSummary: '{count, plural, one {# écart} other {# écarts}} avec la référence : {parts}.',
    snapElement: 'élément {rank}',
    snapTypeName:
      '{type, select, list {liste} string {texte} number {nombre} boolean {booléen} object {objet} other {rien}}',
    snapDiffCount: '{field} : le rejeu a produit {actual} élément(s) là où la référence en avait {expected}.',
    snapDiffMissing: "{field} : le champ n'est plus produit par le rejeu (la référence portait {before}).",
    snapDiffExtra: "{field} : le rejeu produit un champ que la référence n'avait pas ({after}).",
    snapDiffNormalization:
      "{field} : partie variable (id, date, url…) reconnue d'un seul côté — {before} face à {after}. C'est la comparaison qui bute, pas la donnée : réenregistre le cas de test si l'écart persiste.",
    snapDiffType: '{field} : {actualType} {after} là où la référence avait {expectedType} {before}.',
    snapDiffValue: '{field} : le rejeu a produit {after}, la référence disait {before}.',
    // node-bench
    benchInputName: 'Entrée du banc',
    benchNodeMissing: 'Nœud « {nodeName} » absent du workflow',
    benchIssueSticky: 'Une note n’exécute rien.',
    benchIssueTrigger: 'Un déclencheur produit l’entrée : il n’y a rien à alimenter ni à isoler.',
    benchIssueDisabled: 'Nœud désactivé dans le workflow d’origine : le banc l’exécute quand même.',
    benchIssueBinary: 'Ce nœud attend un fichier en entrée : un échantillon JSON ne le reconstitue pas.',
    benchIssueMissingRef:
      'L’expression cite « {ref} », qui n’existe pas dans le workflow : le banc l’ajoutera sous ce nom.',
    benchIssueSubNodes: 'Sous-nœuds recopiés et RÉELLEMENT exécutés : {nodes}.',
    benchFeedExpression: 'Simulé : cité par une expression du nœud testé.',
    benchFeedInput: 'Simulé : alimente l’entrée du nœud testé.',
    benchImpossible: 'Banc impossible pour « {nodeName} » : {reason}',
    benchNotTestable: 'nœud non testable',
    benchStartNode: 'Lancer le banc',
    benchResultNode: 'Rendre le résultat',
    benchStartNotes:
      "Banc d'essai du nœud « {nodeName} » (workflow « {workflowName} »). Posé par la plateforme.",
    benchReadOnly: 'lit ou transforme, sans rien sortir du système',
    benchGateForced: 'Contournement explicite : lancé malgré la production.',
    benchGateProduction:
      'Workflow de production : bascule les ressources sur un env de dev, ou coche le contournement.',
    benchNotRun: 'Le nœud n’a pas été exécuté par le banc.',
    // stub-workflow
    stubTriggerNode: 'Appel reçu',
    stubEchoNode: 'Renvoyer l’entrée',
    stubNotes:
      "Bouchon de « {subWorkflowName} » : posé par la plateforme pour un test. Rien n'est exécuté ici.",
    // side-effect-nodes
    sideEffectEmail: 'envoie un e-mail',
    sideEffectMessage: 'poste un message',
    sideEffectSubWorkflow: 'exécute un autre workflow',
    sideEffectHttp: 'appel HTTP {method}',
    sideEffectDataWrite: 'écrit des données ({operation})',
    // blank-workflow
    blankTriggerName: 'Exécuter le workflow',
    // ai.port
    aiToolLoopInterrupted:
      "Boucle d'outils interrompue après {rounds} tours sans réponse finale{hasTools, select, true { ({tools})} other {}}",
    // time-saved
    timeSavedWrite: '{count, plural, one {# écriture} other {# écritures}}',
    timeSavedSend: '{count, plural, one {# envoi} other {# envois}}',
    timeSavedRead: '{count, plural, one {# lecture} other {# lectures}}',
    timeSavedThink: '{count, plural, one {# passage IA} other {# passages IA}}',
    timeSavedDecide: '{count, plural, one {# décision} other {# décisions}}',
    timeSavedTransform: '{count, plural, one {# mise en forme} other {# mises en forme}}',
    timeSavedNone:
      "Aucun geste humain remplacé n'a été reconnu : le workflow n'est que du câblage, ou ses nœuds sont désactivés.",
    timeSavedCapped:
      "{detail} — plafonné à {max} min : au-delà, l'estimation ne dirait plus que la taille du workflow.",
    // resource-fields
    columnUnknownShape: 'forme de nœud non reconnue : à ouvrir pour vérifier',
    columnNoFields: "ce nœud ne sélectionne ni n'écrit de champs",
    columnAutoMap: "mapping automatique : le nœud écrit les champs qu'il reçoit",
    columnAllRead: 'aucune sélection : le nœud remonte toutes les colonnes',
    columnAlreadyMapped: 'colonne déjà mappée',
    columnAlreadySelected: 'colonne déjà sélectionnée',
    columnFixedMapping:
      'mapping figé sur {count, plural, one {# champ} other {# champs}} : la colonne ne sera pas écrite',
    columnFixedSelection:
      '{count, plural, one {# champ sélectionné} other {# champs sélectionnés}} : la colonne ne remontera pas',
    // workflow-actions
    actionMakeNoPinData:
      "Make n'a pas d'équivalent des données épinglées : on ne peut pas bouchonner un module sans réécrire le scénario.",
    actionMakeNoExecutionData:
      "Make ne rend pas les données produites par une exécution — seules les exécutions en échec en gardent. Il n'y a donc rien à confronter aux expressions.",
    actionMakeEnvSwitchNotYet:
      'La bascule de ressources et la promotion ne sont pas encore portées sur Make.',
    actionMakeRemoteSchemaNotYet:
      "Le contrôle des tables distantes lit les nœuds n8n : il n'est pas encore porté sur les modules Make.",
    actionMakeNoPublish:
      "Make ne sépare pas brouillon et version publiée : un scénario est actif ou il ne l'est pas.",
    // make domain
    makeTokenMalformed: '{base}. Le jeton est malformé ou absent.',
    makeNotAuthorized:
      "{base}. Soit le jeton n'a pas le droit demandé, soit il appartient à une autre zone que {zone} — les deux donnent ce même refus.",
    makeRateLimited: "{base}. Plafond d'appels de l'organisation atteint.",
    makeBlueprintResponseUnreadable: "Réponse de blueprint Make illisible : aucun 'response.blueprint'.",
    makeBlueprintUnreadableWrite: "Contenu illisible comme blueprint Make (aucun 'flow') : rien n'est écrit.",
    makeBlueprintUnreadableExport: "Contenu illisible comme blueprint Make (aucun 'flow') : rien à exporter.",
    makeScenarioEmpty: 'Scénario sans module',
    // adapters
    aiNoKey: 'Aucune clé API IA : réglages IA ou {envVar}',
    aiNotConfigured: 'AiPort non configuré : renseigner les réglages IA ou {envVar}',
    aiRefused: 'La requête IA a été refusée par les garde-fous du modèle',
    aiTruncatedAnthropic:
      "Réponse IA tronquée : budget de {maxTokens} tokens atteint (raisonnement compris) — augmenter maxTokens ou baisser l'effort",
    aiTruncatedMistral:
      'Réponse IA tronquée : budget de {maxTokens} tokens atteint — augmenter maxTokens ou raccourcir le contexte',
    aiEmptyMistral: 'Réponse IA vide : aucun choix rendu par Mistral',
    n8nNoAccount:
      "L'instance « {baseUrl} » n'a pas de compte n8n enregistré. La description des types de nœuds n'est pas servie par l'API publique : renseigne un compte dans la fiche de l'instance, ou reste sur le catalogue mutualisé.",
    n8nLoginRefused:
      'Connexion n8n refusée pour « {email} » → {status}{rateLimited, select, true { (n8n limite les connexions à 5 par minute et par compte)} other {}}: {detail}',
    n8nNoCookie:
      'Connexion n8n acceptée mais aucun cookie {cookie} reçu : un MFA est probablement exigé sur ce compte, et la plateforme ne sait pas le franchir.',
    n8nSessionFailed: 'n8n {method} {path} : session impossible à établir',
    webhookTimeout: 'pas de réponse en {seconds} s',
    webhookUnreachable: 'Webhook {path} injoignable : {reason}',
    n8nNodeTypesUnexpected: 'types/nodes.json : format inattendu',
    makeNoZone: 'Instance Make sans zone : renseigner « eu1.make.com », « eu2.make.com »…',
    makeNoScope: "Instance Make sans périmètre : renseigner l'id de team ou d'organisation.",
    npmRegistryFailed: 'Registre npm → {status} pour {packageName}',
    docsHttpOnly: 'Seules les adresses http(s) sont acceptées',
    docsNoReadme: 'Ce paquet npm n’a pas de README',
    docsEmptyPage: 'La page ne contient aucun texte',
    catalogNoSha: 'Aucun sha rendu pour {path}',
    catalogDownloadFailed: 'Téléchargement du catalogue → {status}',
    catalogSqliteMissing:
      "Lecture du catalogue impossible : `node:sqlite` demande Node 22 ou plus. L'image de l'api doit être bâtie sur node:22-alpine.",
    litellmRevisionUnavailable: 'Révision LiteLLM indisponible (HTTP {status})',
    litellmRevisionUnreadable: 'Révision LiteLLM illisible : pas de sha',
    litellmPricesUnavailable: 'Tarifs LiteLLM indisponibles (HTTP {status})',
    // tester / test-cases
    testCaseNoWebhook:
      'Ce workflow n’expose pas de webhook : rien à rejouer. Les cas de test demandent un déclencheur webhook.',
    testCaseNoData:
      'Exécution sans données exploitables (purgée par n8n, ou sans sortie) : choisis-en une autre.',
    testCaseDefaultName: "Comme l'exécution {executionId}",
    testCaseNotFound: 'Cas de test {id} introuvable',
    testCaseWebhookGone: 'Le workflow n’a plus de nœud webhook : il n’y a plus rien à rejouer.',
    testCaseWebhookNotRegistered:
      'Webhook non enregistré dans n8n : le workflow doit être ACTIF pour répondre sur /webhook/{path}. ({error})',
    testCaseWebhookError: 'Le webhook a répondu en erreur : {error}',
    testCaseNoExecution:
      "Le webhook a répondu, mais aucune exécution n'est apparue en {seconds} s (exécution trop longue, ou non sauvegardée par n8n).",
    testCaseNothingTriggered: 'Aucune exécution déclenchée. {cause}',
    testCaseStillRunning:
      "L'exécution {executionId} tournait encore après {seconds} s : rien à comparer. Relance quand elle sera terminée.",
    testCaseOutputOf: ' (sortie du nœud « {node} »)',
    // manifests
    moduleTesterName: 'Tests',
    moduleTesterDescription: 'Tests de workflows et copies bouchonnées',
    moduleVersioningName: 'Versioning',
    moduleVersioningDescription: 'Snapshots des workflows et export GitHub / Drive',
    moduleConfigTransferName: 'Export / Import de configuration',
    moduleConfigTransferDescription: 'Export et import JSON de toute la configuration',
    moduleResourceDiscoveryName: 'Découverte de ressources',
    moduleResourceDiscoveryDescription: 'Liste les bases et tables réelles via n8n',
    moduleDepGraphName: 'Dépendances',
    moduleDepGraphDescription: 'Carte des workflows et usages des ressources externes',
    moduleWorkflowGroupsName: 'Groupes de workflows',
    moduleWorkflowGroupsDescription: 'Regroupe les workflows par domaine, opérations par lot',
    moduleInstancesName: 'Instances n8n',
    moduleInstancesDescription: 'Connexion aux instances n8n (dev/preprod/prod)',
    moduleModuleAdminName: 'Administration des modules',
    moduleModuleAdminDescription: 'Activation / désactivation des modules',
    moduleWorkflowsName: 'Workflows',
    moduleWorkflowsDescription: 'Miroir local des workflows + synchronisation',
    // tester
    benchNotABench: "« {name} » n'est pas un banc d'essai",
    benchUnreachable: 'Banc injoignable',
    benchNoExecution: 'Aucune exécution du banc trouvée dans n8n.',
    mockMappedExemption: 'ressource mappée : bascule l’env plutôt que de bouchonner',
    testerNoWebhook: "Ce workflow n'expose pas de nœud Webhook actif",
    testerPinLost: "n8n n'a pas épinglé {nodes} — la copie aurait envoyé pour de vrai, elle a été supprimée.",
    testerCopyCreated: 'Copie créée — exécuter depuis n8n puis rapatrier le résultat',
    testerNoExecution: 'Aucune exécution trouvée',
    webhookHeldByOther:
      "« {name} » est inactif, mais son webhook {method} /{path} est enregistré par « {holder} », qui est actif : l'appel aurait déclenché CE workflow-là, pas celui-ci. Active « {name} » (n8n désactivera l'autre, le path est unique) ou donne-lui son propre path.",
    webhookInactive:
      "« {name} » est inactif dans n8n : le webhook de production /{path} n'y est pas enregistré et l'appel repartirait en 404. Active le workflow pour rejouer ce cas.",
    // versioning
    archiveSweepRunning: "Un rangement des exports est déjà en cours — attends qu'il se termine",
    versionNotFound: 'Version {id} introuvable',
    restoreMakeSchedule:
      "Le planning du scénario n'est pas dans le blueprint : il reste celui d'aujourd'hui, quel que soit celui de la version.",
    restoreMakeRefsGone:
      "La version emploie {refs}, que le scénario n'emploie plus aujourd'hui. Si l'une a été supprimée dans Make, le scénario reviendra invalide et refusera de s'activer.",
    restoreMakeRef:
      '{kind, select, connection {la connexion} webhook {le webhook} other {{key}}} #{id} ({module})',
    exportAllRunning: "Un export global est déjà en cours — attends qu'il se termine",
    exportNoTarget: "Aucune cible d'export active — configure GitHub ou Drive dans « Cibles export »",
    exportTargetNotFound: "Cible d'export {id} introuvable",
    cleanupTargetNotFound: 'Cible {id} introuvable',
    cleanupNoWorkflow: 'Aucun workflow avec cet id n8n sur la plateforme — fichier conservé',
    cleanupStaleLocationReady: 'Emplacement obsolète : le fichier à jour existe déjà',
    cleanupStaleLocationReexport: 'Emplacement obsolète : ré-exporte ce workflow avant de supprimer',
    cleanupUnknownFormat: 'Format inconnu, id n8n illisible — fichier conservé',
    cleanupOldFormatReady: 'Ancien format : le fichier à jour existe déjà',
    cleanupOldFormatReexport: 'Ancien format : ré-exporte ce workflow avant de supprimer',
    githubTokenMissing: 'Token GitHub manquant (champ token ou GITHUB_TOKEN)',
    targetTestGithubOnly: 'Test disponible uniquement pour GitHub pour le moment',
    targetTestOwnerRepo: 'owner et repo requis',
    versionRestoreMessage: 'Restore de {versionId}',
    exportDriveDestination: 'Google Drive{hasFolder, select, true { (dossier {folderId})} other {}} → {path}',
    // workflows
    workflowNotFound: 'Workflow {id} introuvable',
    divergenceNothingToCompare:
      'Rien à comparer : cet exemplaire est lui-même la référence (prod), ou son environnement est indéterminé.',
    divergenceNoProd: 'Aucun exemplaire en prod pour ce workflow métier.',
    divergenceNotComparable: 'Contenu non comparable : cette plateforme n’a pas d’empreinte de déploiement.',
    archiveNativelyArchived:
      "« {name} » est archivé nativement côté n8n : il n'est plus modifiable via l'API. Désarchivez-le d'abord dans n8n.",
    workflowNotN8n: '« {name} » est servi par {platform} : cette fonction ne gère que les workflows n8n.',
    publishMissing: 'n8n ne connaît plus ce workflow.',
    publishArchived: 'Workflow archivé côté n8n : la publication est refusée.',
    publishDirectModel:
      'Cette instance n8n ne publie pas par versions : un workflow y est simplement actif ou non, et l’écriture suffit. Il n’y a rien à publier.',
    publishNoRoute:
      'Cette instance n8n ne connaît pas la publication par versions (route /publish absente) : elle est trop ancienne, ou « {name} » a disparu.',
    publishConflict:
      "n8n refuse de publier « {name} » : soit une revue de workflow est en cours, soit un chemin de webhook est déjà pris par un autre workflow. Ce qu'il répond : {detail}",
    publishRefused:
      "n8n a refusé de publier « {name} » (erreur {status}). Le workflow reste en brouillon. Ce qu'il répond : {detail}",
    noDetail: '(aucun détail)',
    instanceIdExpected: 'instanceId attendu',
    minutesExpected: 'minutes : nombre positif attendu',
    findingNotFound: 'Finding {id} introuvable',
    ignoreRuleNotFound: 'Règle {id} introuvable',
    workflowNameExpected: 'Nom du workflow attendu',
    viewOutputBranch: 'sortie {index}',
    unknownType: 'inconnu',
    // config-transfer
    importWorkflowMissing:
      '{what} : workflow introuvable ({instanceUrl} / {externalId}) — synchronisez les workflows depuis n8n puis ré-importez le même fichier',
    importSubject:
      '{kind, select, findingIgnore {Exclusion de finding "{name}"} group {Groupe "{name}"} link {Lien manuel "{name}"} monitor {Monitor "{name}"} other {{name}}}',
    importNoLabel: 'sans libellé',
    importGroupInstanceMissing: 'Groupe "{name}" : instance {instanceUrl} absente de la cible',
    configExportDisabled:
      "Export de configuration désactivé sur cette installation ({envVar} non posé). Il ne s'ouvre qu'en local, où le fichier ne quitte pas la machine.",
    importInvalidFile: "Fichier invalide : ce n'est pas un export de configuration de la plateforme",
    importUnsupportedVersion: 'Version de bundle non supportée : {version} (attendu : {expected})',
    importInstanceNoKey:
      'Instance "{name}" créée sans apiKey (export sans secrets) : à renseigner manuellement',
    importTargetNoSecrets:
      'Cible export "{name}" créée sans ses secrets (token…) : à renseigner manuellement',
    importMonitorUnresolved:
      'Monitor "{name}" : instance non résolue ({hasRef, select, true {instance {instanceRef} absente de cette plateforme} other {bundle antérieur à l\'ajout de instanceRef}}) — importé désactivé, à réactiver après avoir choisi son instance',
    importKumaNoPassword:
      'Réglages Uptime Kuma importés sans mot de passe (export sans secrets) : à renseigner manuellement',
    importAiNoKey: 'Réglages IA importés sans clé API (export sans secrets) : à renseigner manuellement',
    // instances
    instanceNotFoundAnon: 'Instance introuvable',
    instanceNotFound: 'Instance {id} introuvable',
    platformUnsupported: 'Plateforme « {platform} » non gérée par cette version.',
    apiKeyRequired: 'Clé API requise',
    apiKeyRequiredForTest: 'Clé API requise pour tester la connexion',
    nameRequired: 'name requis',
    // module-admin
    aiKeyRequired: 'Clé API {provider} requise',
    aiProviderNoKey: "{provider} n'a pas de clé API : la renseigner avant de basculer (ou poser {envVar})",
    aiCallFailed: 'Appel IA KO : {error}',
    aiProviderUnknown: 'Fournisseur IA inconnu : {provider}',
    aiProviderAbsent: '(absent)',
    // infra
    probeFailed: '{what} a échoué : {detail}',
    probeWebhookUnreachable: 'Webhook de la sonde injoignable',
    passwordTooShort: 'Mot de passe : {min} caractères minimum.',
    alreadyConfigured: 'La plateforme est déjà configurée.',
    // resource-discovery
    discoveryUnknownStep: 'Étape inconnue : {provider}/{stepId}',
    discoveryCredentialMismatch: 'Credential {credentialType} incompatible avec {provider}',
    discoveryParentRequired: "L'étape {stepId} requiert un parentId (item de {parentStepId})",
    discoveryHostRequired: "{provider} range l'URL de son API dans le credential : renseigne son host",
    discoveryNotProbe: "{externalId} n'est pas un workflow de découverte",
    credentialHostRequired: 'credentialId et host sont requis',
    instanceIdRequired: 'instanceId est requis',
    workflowUnknown: 'Workflow {id} inconnu',
    groupUnknown: 'Groupe {id} inconnu',
    untitled: 'sans titre',
    // dep-graph
    linkEndsRequired: 'Workflow de départ et d’arrivée requis',
    linkSelf: 'Un workflow ne peut pas se lier à lui-même',
    linkUnknownWorkflow: 'Workflow inconnu — synchronise l’instance puis réessaie',
    linkDuplicate: 'Ces deux workflows sont déjà liés dans ce sens',
    linkNotFound: 'Lien inconnu : {id}',
    mapArchived: 'archivé',
    mapUnknownInstance: 'instance inconnue',
    keyMissing: 'key manquante',
    // workflow-groups
    groupNameInstanceRequired: 'name et instanceId sont requis',
    makeEdgeRoute: 'route {index}',
    makeEdgeElse: 'sinon',
    makeEdgeIf: 'si {index}',
  },
);
