import { defineMessages } from '../catalog';

/** Surveillance et alertes : monitoring, Uptime Kuma, notifier, performance, coûts IA, tableau de bord, logs. */
export const ops = defineMessages(
  {
    // Manifests des modules
    moduleMonitoringName: 'Monitoring',
    moduleMonitoringDescription: 'Heartbeats and execution errors, relayed to Uptime Kuma',
    moduleNotifierName: 'Alerts',
    moduleNotifierDescription: 'Alerts to Slack or a webhook',
    modulePerformanceName: 'Performance',
    modulePerformanceDescription: 'Execution durations and statuses, duration drifts',
    moduleAiCostName: 'AI costs',
    moduleAiCostDescription: 'LLM costs extracted from executions and priced',
    moduleDashboardName: 'Dashboard',
    moduleDashboardDescription: 'What changed since your last visit',
    moduleAppLogsName: 'Platform logs',
    moduleAppLogsDescription: 'Latest API log lines, on screen',

    // Registre des modules
    moduleNotDisableable: 'The core module "{id}" cannot be disabled',
    moduleDisabled: 'Module "{id}" is disabled',

    // Introuvables
    instanceNotFound: 'Instance {id} not found',
    monitorNotFound: 'Monitor {id} not found',
    errorGroupNotFound: 'Error group {id} not found',
    channelNotFound: 'Channel {id} not found',
    heartbeatNotFound: 'Heartbeat monitor not found or disabled',
    platformNotSupported: 'Platform “{platform}” is not supported by this version.',

    // Uptime Kuma
    kumaNotConfigured:
      'Uptime Kuma is not configured: fill in the Kuma settings (Monitors page) or KUMA_URL/KUMA_USERNAME/KUMA_PASSWORD in the .env',
    kumaFailure: 'Uptime Kuma — {action}: {detail}{hint}',
    kumaMissingColumnHint:
      ' — the “{column}” column is required by this Kuma version and is not sent: complete the payload of `KumaAdminAdapter.createPushProbe`.',
    kumaActionReadMonitors: 'reading monitors',
    kumaActionReadProbes: 'reading probes',
    kumaActionCreateTag: 'creating the tag',
    kumaActionTagProbes: 'tagging probes',
    kumaActionCreatePushProbe: 'creating the push probe',
    kumaActionUpdateIntervals: 'updating intervals',
    kumaNoProbeSelected: 'No probe selected',
    kumaUrlUserRequired: 'Kuma URL and user required',
    kumaPasswordRequired: 'Kuma password required',
    kumaPasswordRequiredForTest: 'Kuma password required to test',
    kumaConnectionFailed: 'Uptime Kuma connection failed: {detail}',
    kumaSkipNotCandidate: 'probe not in the candidate list',
    kumaSkipNotFound: 'not found in Kuma',
    kumaSkipAlreadyLinked: 'already linked to a local monitor',
    kumaSkipTypeNotImportable: 'type "{type}" cannot be imported',
    kumaSkipImported: 'imported probe, configured in Kuma',
    kumaSkipNoProbe: 'no Kuma probe',
    kumaSkipProbeMissing: 'probe #{id} missing from Kuma',
    errorWatchMonitorName: '{instance} — execution errors',

    // Sondes redondantes
    redundancyPaused:
      'Paused in Uptime Kuma while its monitor is enabled in the platform: it no longer watches anything.',
    redundancyDuplicateErrorWatch:
      'Duplicate of the error-watch monitor of “{instance}”, which detects the same errors without a dedicated workflow.',
    redundancyHealthWebhook:
      'Calls a webhook of “{instance}” on every check{hasCost, select, true { (~{perDay} executions/day)} other {}}; the error-watch detects failures without executing anything.',

    // Messages poussés vers la sonde error-watch
    watchApiUnreachable: 'API unreachable: {detail}',
    watchBaseline: 'OK (baseline)',
    watchOnlyIgnored: 'OK ({ignored, plural, one {# error} other {# errors}} outside monitored envs)',
    watchNewErrors:
      '{count, plural, one {# new error} other {# new errors}}: {summary}{ignored, plural, =0 {} other { (+# outside prod)}}',

    // Journal d'un groupe d'erreurs
    regressionNote:
      'Came back on {at} (execution {executionId}){resolved, select, true {, although resolved on {resolvedAt}.} other {.}}',

    // Checklist de migration du monitoring
    checklistMonitorExistsLabel: '“Execution errors” monitor created for the instance',
    checklistMonitorExistsDetail:
      'Watches failed executions through the n8n API, without generating any execution.',
    checklistMonitorExistsHelp:
      'The “execution errors” monitor replaces the n8n workflow that used to do this job. Every 2 minutes, the platform asks the n8n API for the list of failed executions and only reports those never seen before (cursor). Advantage over the workflow version: it creates no execution in n8n, so no more noise while you debug, and the API key stays on the platform side.',
    checklistMonitorEnabledLabel: 'Monitor enabled (automatic check every 2 min)',
    checklistMonitorEnabledDetail: 'Create the monitor first.',
    checklistMonitorEnabledHelp:
      'While the monitor is disabled, nothing runs automatically: you can only run checks by hand. We deliberately leave it off while checking its behaviour, then enable it so the cron takes it over.',
    checklistKumaLinkedLabel: 'Uptime Kuma push probe linked',
    checklistKumaLinkedDetail:
      'Create a new probe here, or reuse the existing probe of the n8n workflow: “Import from Kuma” (Monitors page) then paste its push URL into the monitor.',
    checklistKumaLinkedHelp:
      'It is the alert channel. The check runs here, but Uptime Kuma is what knows how to notify (mail, Telegram…). A “push” probe is a passive monitor: it fetches nothing, it waits to be called on its URL — which the platform does after each check, with up/down and the detail of the failing workflows. It brings 3 things: notifications, uptime history, and a safety net — if the platform goes down or the monitor is switched off, nobody pushes any more and Kuma goes down on its own. Without it, the check still runs but you only see it by opening the Monitors page.',
    checklistBaselineLabel: 'First check done (baseline of the error cursor)',
    checklistBaselineDetail: 'Last check: {at} ({status})',
    checklistBaselineHelp:
      'The monitor remembers the ID of the last failed execution it saw, and then only reports what is more recent — so an error alerts only once. The very first check only sets this marker: it does not alert on your history of past errors. Until it has happened, the monitor does not know where to start from.',
    checklistLegacyRemovedLabel: 'Old n8n error-monitoring workflow deleted',
    checklistLegacySyncFirst: "Sync the instance's workflows first to check.",
    checklistLegacyToDelete:
      'To delete in n8n (once the monitor is broken in): {workflows} — according to the last sync.',
    checklistLegacyNone: 'No workflow polls the failed-executions API (according to the last sync).',
    checklistLegacyRemovedHelp:
      'Two monitors in parallel = duplicate alerts. Once the monitor is broken in (allow 1 to 2 days running side by side to compare), the old n8n workflow becomes useless: deleting it also frees the executions it generated on every run. Detection is based on the workflows JSON as synced in the DB — click “Sync” on the instance to refresh.',
    checklistApiKeyLabel: 'n8n API key regenerated (manual step)',
    checklistApiKeyDetail:
      'The old workflow contained the API key in clear text (JSON + versioning snapshots). After deleting it: regenerate the key in n8n (Settings → API) and update it here (Instances page → Edit).',
    checklistApiKeyHelp:
      'The old workflow carried the n8n API key in clear text in the parameters of a node. Everything that read this JSON knows it: the versioning module copied it into the GitHub / Drive snapshots, and it stays in the history even after the workflow is deleted. Regenerating it is the only way to invalidate it. Manual step: the platform cannot create an API key through the n8n API.',

    // Canaux d'alerte
    channelNameRequired: 'name is required',
    channelTypeInvalid: 'type: slack or webhook',
    channelUrlRequired: 'url is required',
    channelUrlInvalid: 'invalid url (http/https expected)',
    channelTestTitle: '✅ n8n ops platform test',
    channelTestBody: 'The “{name}” channel is properly connected.',

    // Alertes
    alertNewGroup: '🆕 New problem',
    alertRegressed: '🔁 Problem is back (relapse no. {regressions})',
    alertStillThere: '🔁 Still there — {workflow}',
    alertInstance: 'Instance: {name}',
    alertNode: 'Node: {name}',
    alertType: 'Type: {category}',
    alertCategoryAuth: 'authentication',
    alertCategoryRateLimit: 'rate limit',
    alertCategoryTimeout: 'timeout',
    alertCategoryNetwork: 'network',
    alertCategoryData: 'data',
    alertDigest:
      '{count, plural, one {# new failed execution} other {# new failed executions}} since {since} ({total} in total).',
    alertModelTitle: '{retired, select, true {⛔️ Model retired} other {⚠️ Model deprecated}} — {pattern}',
    alertModelProvider: 'Provider: {provider}',
    alertModelRetiresAt: 'Announced retirement: {date}',
    alertModelSuccessor: 'Successor: {pattern}',
    alertModelNodes:
      '{nodes, plural, one {# node} other {# nodes}} in {workflows, plural, one {# workflow} other {# workflows}}: {names}',
    alertDriftTitle: '🐢 Duration drift — {workflow}',
    alertDriftMedian:
      'Median ×{ratio} vs the previous {days} days{hasCurrent, select, true { (current: {current} s)} other {}}',
    alertDriftOnce: 'Only one alert per drift: it will re-arm when the duration comes back down.',
    alertRelayBrokenTitle: '🔕 Monitoring silent — {monitor}',
    alertRelayBrokenFailures: '{failures} consecutive failures pushing to the Uptime Kuma probe.',
    alertRelayLastError: 'Last error: {reason}',
    alertRelayBrokenImpact: 'While the relay is down, a stop of this monitor would trigger NO alert.',
    alertRelayBrokenCheck: 'To check: does the probe still exist in Kuma? (Monitors page → Provision)',
    alertRelayRestoredTitle: '🔔 Monitoring restored — {monitor}',
    alertRelayRestoredBody: 'The push to the Uptime Kuma probe works again after {failures} failures.',
    alertBudgetTitle: '💸 AI budget exceeded — {cost} $ / {budget} $',
    alertBudgetBody: 'LLM cost for {date} above the daily budget.',
    alertBudgetTop: 'Top contributors:\n{top}',
    alertBudgetOnce: 'Only one alert per day — details on the AI costs page.',

    // Tableau de bord, coûts IA
    noClient: 'No client',
    unknownModel: '(unknown model)',
    openInPlatform: 'Open in the platform',
  },
  {
    moduleMonitoringName: 'Monitoring',
    moduleMonitoringDescription: "Heartbeats et erreurs d'exécution, relayés vers Uptime Kuma",
    moduleNotifierName: 'Alertes',
    moduleNotifierDescription: 'Alertes vers Slack ou un webhook',
    modulePerformanceName: 'Performance',
    modulePerformanceDescription: "Durées et statuts d'exécution, dérives de durée",
    moduleAiCostName: 'Coûts IA',
    moduleAiCostDescription: 'Coûts LLM extraits des exécutions et valorisés',
    moduleDashboardName: 'Tableau de bord',
    moduleDashboardDescription: 'Ce qui a changé depuis ta dernière visite',
    moduleAppLogsName: 'Logs de la plateforme',
    moduleAppLogsDescription: "Dernières lignes de log de l'API, à l'écran",

    moduleNotDisableable: 'Le module core "{id}" n\'est pas désactivable',
    moduleDisabled: 'Module "{id}" désactivé',

    instanceNotFound: 'Instance {id} introuvable',
    monitorNotFound: 'Monitor {id} introuvable',
    errorGroupNotFound: "Groupe d'erreurs {id} introuvable",
    channelNotFound: 'Canal {id} introuvable',
    heartbeatNotFound: 'Monitor heartbeat introuvable ou désactivé',
    platformNotSupported: 'Plateforme « {platform} » non gérée par cette version.',

    kumaNotConfigured:
      'Uptime Kuma non configuré : renseigner les réglages Kuma (page Monitors) ou KUMA_URL/KUMA_USERNAME/KUMA_PASSWORD dans le .env',
    kumaFailure: 'Uptime Kuma — {action} : {detail}{hint}',
    kumaMissingColumnHint:
      " — la colonne « {column} » est obligatoire dans cette version de Kuma et n'est pas envoyée : compléter le payload de `KumaAdminAdapter.createPushProbe`.",
    kumaActionReadMonitors: 'lecture des monitors',
    kumaActionReadProbes: 'lecture des sondes',
    kumaActionCreateTag: 'création de l’étiquette',
    kumaActionTagProbes: 'marquage des sondes',
    kumaActionCreatePushProbe: 'création de la sonde push',
    kumaActionUpdateIntervals: 'mise à jour des intervalles',
    kumaNoProbeSelected: 'Aucune sonde sélectionnée',
    kumaUrlUserRequired: 'URL et utilisateur Kuma requis',
    kumaPasswordRequired: 'Mot de passe Kuma requis',
    kumaPasswordRequiredForTest: 'Mot de passe Kuma requis pour tester',
    kumaConnectionFailed: 'Connexion Uptime Kuma KO : {detail}',
    kumaSkipNotCandidate: 'sonde absente de la liste des candidates',
    kumaSkipNotFound: 'introuvable côté Kuma',
    kumaSkipAlreadyLinked: 'déjà rattachée à un monitor local',
    kumaSkipTypeNotImportable: 'type "{type}" non importable',
    kumaSkipImported: 'sonde importée, réglée dans Kuma',
    kumaSkipNoProbe: 'pas de sonde Kuma',
    kumaSkipProbeMissing: 'sonde #{id} absente de Kuma',
    errorWatchMonitorName: "{instance} — erreurs d'exécution",

    redundancyPaused:
      'En pause côté Uptime Kuma alors que son monitor est activé dans la plateforme : elle ne surveille plus rien.',
    redundancyDuplicateErrorWatch:
      'Doublon du monitor error-watch de « {instance} », qui détecte les mêmes erreurs sans workflow dédié.',
    redundancyHealthWebhook:
      "Appelle un webhook de « {instance} » à chaque check{hasCost, select, true { (~{perDay} exécutions/jour)} other {}} ; l'error-watch détecte les échecs sans rien exécuter.",

    watchApiUnreachable: 'API injoignable : {detail}',
    watchBaseline: 'OK (baseline)',
    watchOnlyIgnored: 'OK ({ignored} erreur(s) hors env surveillé)',
    watchNewErrors:
      '{count} nouvelle(s) erreur(s) : {summary}{ignored, plural, =0 {} other { (+# hors prod)}}',

    regressionNote:
      'Revenue le {at} (exécution {executionId}){resolved, select, true {, alors que traitée le {resolvedAt}.} other {.}}',

    checklistMonitorExistsLabel: "Monitor « erreurs d'exécution » créé pour l'instance",
    checklistMonitorExistsDetail:
      "Surveille les exécutions en erreur via l'API n8n, sans générer d'exécution.",
    checklistMonitorExistsHelp:
      "Le monitor « erreurs d'exécution » remplace le workflow n8n qui faisait ce travail. Toutes les 2 minutes, la plateforme demande à l'API n8n la liste des exécutions en erreur et ne signale que celles jamais vues (curseur). Avantage sur la version workflow : ça ne crée aucune exécution dans n8n, donc plus de bruit quand tu debug, et la clé API reste côté plateforme.",
    checklistMonitorEnabledLabel: 'Monitor activé (check automatique toutes les 2 min)',
    checklistMonitorEnabledDetail: "Créer d'abord le monitor.",
    checklistMonitorEnabledHelp:
      "Tant que le monitor est désactivé, rien ne tourne automatiquement : tu peux seulement lancer des checks à la main. On le laisse volontairement off le temps de vérifier son comportement, puis on l'active pour que le cron le prenne en charge.",
    checklistKumaLinkedLabel: 'Sonde push Uptime Kuma rattachée',
    checklistKumaLinkedDetail:
      'Créer une sonde neuve ici, ou réutiliser la sonde existante du workflow n8n : « Importer depuis Kuma » (page Monitors) puis coller son URL push dans le monitor.',
    checklistKumaLinkedHelp:
      "C'est le canal d'alerte. Le check tourne ici, mais c'est Uptime Kuma qui sait notifier (mail, Telegram…). Une sonde « push » est un moniteur passif : elle ne va rien chercher, elle attend qu'on l'appelle sur son URL — ce que la plateforme fait après chaque check, avec up/down et le détail des workflows en erreur. Elle apporte 3 choses : les notifications, l'historique d'uptime, et un garde-fou — si la plateforme tombe ou si le monitor est coupé, plus personne ne pousse et Kuma passe en down tout seul. Sans elle, le check tourne quand même mais tu ne le vois qu'en ouvrant la page Monitors.",
    checklistBaselineLabel: "Premier check effectué (baseline du curseur d'erreurs)",
    checklistBaselineDetail: 'Dernier check : {at} ({status})',
    checklistBaselineHelp:
      "Le monitor mémorise l'ID de la dernière exécution en erreur qu'il a vue, et ne signale ensuite que ce qui est plus récent — donc une erreur n'alerte qu'une fois. Le tout premier check sert uniquement à poser ce repère : il ne déclenche pas d'alerte sur ton historique d'erreurs passées. Tant qu'il n'a pas eu lieu, le monitor ne sait pas d'où partir.",
    checklistLegacyRemovedLabel: "Ancien workflow n8n de monitoring d'erreurs supprimé",
    checklistLegacySyncFirst: "Synchronise d'abord les workflows de l'instance pour vérifier.",
    checklistLegacyToDelete:
      "À supprimer dans n8n (après rodage du monitor) : {workflows} — d'après la dernière synchro.",
    checklistLegacyNone:
      "Aucun workflow ne polle l'API des exécutions en erreur (d'après la dernière synchro).",
    checklistLegacyRemovedHelp:
      "Deux surveillances en parallèle = alertes en double. Une fois le monitor rodé (compte 1 à 2 jours à tourner en même temps pour comparer), l'ancien workflow n8n devient inutile : le supprimer libère aussi les exécutions qu'il générait à chaque passage. La détection se base sur le JSON des workflows tel que synchronisé en DB — clique « Synchroniser » sur l'instance pour rafraîchir.",
    checklistApiKeyLabel: 'Clé API n8n régénérée (étape manuelle)',
    checklistApiKeyDetail:
      "L'ancien workflow contenait la clé API en clair (JSON + snapshots versioning). Après sa suppression : régénérer la clé dans n8n (Settings → API) et la mettre à jour ici (page Instances → Éditer).",
    checklistApiKeyHelp:
      "L'ancien workflow portait la clé API n8n en clair dans les paramètres d'un nœud. Tout ce qui a lu ce JSON la connaît : le module versioning l'a recopiée dans les snapshots GitHub / Drive, et elle reste dans l'historique même après suppression du workflow. La régénérer est le seul moyen de l'invalider. Étape manuelle : la plateforme ne peut pas créer de clé API via l'API n8n.",

    channelNameRequired: 'name requis',
    channelTypeInvalid: 'type : slack ou webhook',
    channelUrlRequired: 'url requise',
    channelUrlInvalid: 'url invalide (http/https attendu)',
    channelTestTitle: '✅ Test de la plateforme n8n ops',
    channelTestBody: 'Le canal « {name} » est bien branché.',

    alertNewGroup: '🆕 Nouveau problème',
    alertRegressed: '🔁 Problème revenu ({regressions}ᵉ rechute)',
    alertStillThere: '🔁 Toujours là — {workflow}',
    alertInstance: 'Instance : {name}',
    alertNode: 'Nœud : {name}',
    alertType: 'Type : {category}',
    alertCategoryAuth: 'authentification',
    alertCategoryRateLimit: 'rate limit',
    alertCategoryTimeout: 'timeout',
    alertCategoryNetwork: 'réseau',
    alertCategoryData: 'données',
    alertDigest:
      '{count, plural, one {# nouvelle exécution} other {# nouvelles exécutions}} en erreur depuis {since} ({total} au total).',
    alertModelTitle: '{retired, select, true {⛔️ Modèle retiré} other {⚠️ Modèle déprécié}} — {pattern}',
    alertModelProvider: 'Provider : {provider}',
    alertModelRetiresAt: 'Retrait annoncé : {date}',
    alertModelSuccessor: 'Successeur : {pattern}',
    alertModelNodes: '{nodes} nœud(s) dans {workflows} workflow(s) : {names}',
    alertDriftTitle: '🐢 Dérive de durée — {workflow}',
    alertDriftMedian:
      'Médiane ×{ratio} vs les {days} jours précédents{hasCurrent, select, true { (actuelle : {current} s)} other {}}',
    alertDriftOnce: 'Une seule alerte par dérive : elle se réarmera quand la durée redescendra.',
    alertRelayBrokenTitle: '🔕 Surveillance muette — {monitor}',
    alertRelayBrokenFailures: "{failures} échecs d'affilée en poussant vers la sonde Uptime Kuma.",
    alertRelayLastError: 'Dernière erreur : {reason}',
    alertRelayBrokenImpact:
      'Tant que le relais est coupé, un arrêt de ce monitor ne déclencherait AUCUNE alerte.',
    alertRelayBrokenCheck:
      'À vérifier : la sonde existe-t-elle encore dans Kuma ? (page Monitors → Provisionner)',
    alertRelayRestoredTitle: '🔔 Surveillance rétablie — {monitor}',
    alertRelayRestoredBody: 'Le push vers la sonde Uptime Kuma repasse après {failures} échecs.',
    alertBudgetTitle: '💸 Budget IA dépassé — {cost} $ / {budget} $',
    alertBudgetBody: 'Coût LLM du {date} au-dessus du budget quotidien.',
    alertBudgetTop: 'Plus gros contributeurs :\n{top}',
    alertBudgetOnce: 'Une seule alerte par jour — le détail est sur la page Coûts IA.',

    noClient: 'Sans client',
    unknownModel: '(modèle inconnu)',
    openInPlatform: 'Ouvrir dans la plateforme',
  },
);
