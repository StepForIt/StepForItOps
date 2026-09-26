import { defineMessages } from '../catalog';

/** Bascule, promotion, publication, verrou d'un exemplaire, chaîne d'environnements. */
export const env = defineMessages(
  {
    manifestName: 'Environment switch',
    manifestDescription: 'Resource switching and promotion between environments',

    quoted: '"{name}"',
    workflowNotFound: 'Workflow {id} not found',

    // Lot de gestes d'environnement (plan)
    bulkNoEnvLabel: 'no env',
    bulkSameEnv: 'Source env and target env are the same: there is nothing to do.',
    bulkAlreadyMarked: 'already declared {env}',
    bulkNoUnmarked: 'no exemplar without env to declare',
    bulkNoUsableSource: 'no usable {env} exemplar (missing, archived or deleted in n8n)',
    bulkSeveralSources: 'several {env} exemplars — pick which one goes on its page',
    bulkTargetExists: 'the family already has its {env} exemplar',
    bulkCopyExists: 'a {env} copy already exists on this instance',
    bulkSeveralTargets: 'several {env} exemplars — pick the target on its page',
    bulkUnknownAction: 'Unknown action: {action}',
    bulkNoFamily: 'No business workflow selected',
    bulkEnvNotDeclared: 'Env not declared: {env}',
    bulkMarkFromUnmarked: 'Declaring the env starts from exemplars without env',
    bulkSourceRequired: 'Source env is required',

    // Ce qu'il reste à un humain
    readinessChainBlock: 'the environment chain is in blocking mode and this promotion skips a step',
    readinessDiff: 'Review what the promotion changes on the target',
    readinessLocked: 'The target is locked: overriding requires a reason',
    readinessTargetActive: 'The target is ACTIVE: it is running right now',
    readinessForce: 'Gates are red — force knowingly',
    readinessConfirmSkip: 'Confirm skipping a step of the chain',
    readinessSameAsSource: 'the workflow is already in the target env',
    readinessCopyExists: 'a copy already has this name on the instance',
    readinessUnmapped: 'Resources without mapping: the copy will stay wired to the source data',

    // Verrou
    lockReasonTooShort: 'A reason is required ({min} characters minimum).',
    lockReasonTooLong: 'Reason too long ({max} characters maximum).',
    lockRefusal:
      '{count, plural, one {{names} is locked: overriding requires a reason.} other {{names} are locked: overriding requires a reason.}}',
    lockOutsideRequest: 'outside a request',

    // Refus de publication par n8n
    publishCredentialUnresolved: 'credential "{name}" unresolved',
    publishRefusalNode: '"{node}": {problems}',
    publishRefusalRest: ' (+ {count, plural, one {# other node} other {# other nodes}})',
    publishRefusal:
      'n8n refuses to save this workflow: {count, plural, one {# node it considers incomplete} other {# nodes it considers incomplete}} — {detailed}{rest}. Nothing was changed in n8n: fix these nodes in n8n (reassign the credentials), then resync.',
    writeEffectDraft:
      '"{name}" has never been published on this instance. The change will be saved as a draft: it will not run until the workflow is published. You can do it from here once the diff is applied.',

    // Publication des appelés
    calleeArchived: 'archived in n8n: it can no longer be published',
    calleeSelfStarting: 'also has a {trigger} trigger: publishing it would start it',
    calleeStuck: 'calls {names}, to publish first',
    calleeLocked: 'locked: to publish by hand',
    calleeRefused: 'n8n refused to publish it: {error}',
    pubNoCounterpart: 'no counterpart on the target',
    pubArchived: 'archived in n8n',
    pubRunNotFound: 'Publication chain not found.',
    pubRunNotPaused: 'This chain is not paused.',
    pubRunRunning: 'This chain is already running.',
    pubStepLocked: 'locked: lift the lock to publish it, or skip the step',
    pubN8nRefused: 'n8n refused ({status}): {detail}',
    pubNoDetail: 'no detail',

    // Points d'entrée
    pathNoKeeper: 'no exemplar in a public-URL env nor active: cannot tell which one keeps the URL',
    pathIdOnly:
      'URL derived from the node identifier, which n8n does not let you change: recreate the node in the copy',
    pathEnvUnknown: 'undetermined env: name the workflow "- DEV" or set its env:* tag',
    pathSameTarget: 'several copies would target /{path}: give them distinct paths by hand',
    pathFixNone: 'No workflow to fix.',
    pathFixStale:
      '{count, plural, one {# workflow is} other {# workflows are}} no longer in the plan (state changed in n8n?): review the plan before applying.',
    entryScheduled: 'scheduled',
    entryError: 'error of a workflow',
    entryManual: 'started by hand',
    dynamicUrl: 'Dynamic URL',

    // Proposition de version
    versionNewOnTarget: '"{name}" does not exist on the target yet: it arrives whole.',
    versionAiCapped:
      '{reason} (The AI suggested a {proposed, select, major {major} minor {minor} other {patch}} bump, brought down to {capped, select, major {major} minor {minor} other {patch}}: the rule only sees a {rule, select, major {major} minor {minor} other {patch}} one.)',
    versionReprise:
      '"{name}" has not changed since it went live in {version}: the promotion carries this number over, it publishes nothing new.',
    versionManualReprise: 'Carry-over chosen by hand: the source number is carried over as is.',
    versionManualLevel: 'Level chosen by hand.',
    notSemver: '"{version}" is not a semantic version (expected: 1.2.3).',

    // Promotion
    promoteBlocked: 'Promotion blocked: {blockers}. Get the gates back to green (or force knowingly).',
    promoteRemoteBlocked: 'Promotion of "{name}" blocked: {reason}',
    freeUrlFailed: 'Could not free the URL held by "{holder}": {error}. Nothing was promoted.',
    rereadFailed:
      'Could not re-read "{name}" in n8n ({error}): promotion abandoned rather than pushing a stale state.',
    tableUnread: 'not read',
    sameInstanceNoEnv:
      'Same instance without target env: the workflow would overwrite itself. Choose the env to push to.',
    alreadyThatExemplar:
      '"{name}" is already the {env} exemplar: pushing here would overwrite it with itself.',
    targetArchived:
      '"{name}" exists on {instance} but is ARCHIVED there: n8n refuses any change to an archived workflow. Unarchive it in n8n (or rename it) before promoting.',
    gateFindings: '{count, plural, one {# finding} other {# findings}} of severity error',
    gateTests: '{count, plural, one {# test} other {# tests}} failing',
    gateArchivedSubs:
      '{count, plural, one {# sub-workflow} other {# sub-workflows}} archived on the target: {names} — unarchive them in n8n, an archived workflow no longer runs',
    gateUnknownSubs:
      '{count, plural, one {# sub-workflow} other {# sub-workflows}} unknown to the platform (resync the source instance): {names}',
    gateUncoveredSubs:
      '{count, plural, one {# sub-workflow} other {# sub-workflows}} without counterpart on the target: {names}',
    gateEntryClash:
      '"{node}": /{url} is already served by "{holder}" (active){hasMove, select, true { — tick "free the URL" to move it to /{move}} other { — free the URL in n8n}}',
    gateVersionAhead:
      'the target carries {target} and the source {source}: the target received something the source does not have — check you are not overwriting a fix made directly there',
    noVersion: 'no version',
    chainBlockRefusal:
      'The environment chain is in blocking mode and this promotion skips {skipped}: go through {route}, or tick "go through intermediate envs".',
    chainWarnRefusal:
      'This promotion skips {skipped} (declared chain: {chain}). Confirm the skip explicitly, or route it through the intermediate envs.',
    remoteSchemaBlocker:
      '{count, plural, one {# column or table} other {# columns or tables}} missing on the target ({nodes}) — create them before promoting',
    chainGuardRefusal:
      '"{name}" is in {env}, and the environment chain is in blocking mode: a downstream env is only changed by promoting into it. Make the change in {upstream}, then promote.',

    // Duplication d'un groupe
    groupDoubles:
      '{count, plural, one {# copy already has} other {# copies already have}} the target name ({names}): duplicating would create a second one. Tick "duplicate anyway" to override.',
    groupUnknown: 'Group {id} unknown',
    groupEmpty: 'The group contains no workflow',
  },
  {
    manifestName: "Bascule d'environnement",
    manifestDescription: 'Bascule de ressources et promotion entre environnements',

    quoted: '« {name} »',
    workflowNotFound: 'Workflow {id} introuvable',

    bulkNoEnvLabel: 'sans env',
    bulkSameEnv: "Env source et env cible identiques : il n'y a rien à faire.",
    bulkAlreadyMarked: 'déjà déclaré {env}',
    bulkNoUnmarked: 'aucun exemplaire sans env à déclarer',
    bulkNoUsableSource: 'aucun exemplaire {env} utilisable (absent, archivé ou supprimé dans n8n)',
    bulkSeveralSources: 'plusieurs exemplaires {env} — lequel part est à choisir sur sa page',
    bulkTargetExists: 'la famille a déjà son exemplaire {env}',
    bulkCopyExists: 'une copie {env} existe déjà sur cette instance',
    bulkSeveralTargets: 'plusieurs exemplaires {env} — la cible est à choisir sur sa page',
    bulkUnknownAction: 'Action inconnue : {action}',
    bulkNoFamily: 'Aucun workflow métier sélectionné',
    bulkEnvNotDeclared: 'Env non déclaré : {env}',
    bulkMarkFromUnmarked: "Déclarer l'env part des exemplaires sans env",
    bulkSourceRequired: 'Env source obligatoire',

    readinessChainBlock: "la chaîne d'environnements est en mode bloquant et cette promotion saute une étape",
    readinessDiff: 'Relire ce que la promotion change sur la cible',
    readinessLocked: 'La cible est verrouillée : forcer demande une raison',
    readinessTargetActive: 'La cible est ACTIVE : elle tourne en ce moment',
    readinessForce: 'Gates au rouge — forcer en connaissance de cause',
    readinessConfirmSkip: "Confirmer le saut d'une étape de la chaîne",
    readinessSameAsSource: "le workflow est déjà dans l'env cible",
    readinessCopyExists: 'une copie porte déjà ce nom sur l’instance',
    readinessUnmapped: 'Ressources sans mapping : la copie restera branchée sur les données de la source',

    lockReasonTooShort: 'Raison obligatoire ({min} caractères au moins).',
    lockReasonTooLong: 'Raison trop longue ({max} caractères au plus).',
    lockRefusal:
      '{count, plural, one {{names} est verrouillé : forcer demande une raison.} other {{names} sont verrouillés : forcer demande une raison.}}',
    lockOutsideRequest: 'hors requête',

    publishCredentialUnresolved: 'credential « {name} » non résolue',
    publishRefusalNode: '« {node} » : {problems}',
    publishRefusalRest: ' (+ {count, plural, one {# autre} other {# autres}} nœud(s))',
    publishRefusal:
      'n8n refuse d’enregistrer ce workflow : {count, plural, one {# nœud qu’il juge incomplet} other {# nœuds qu’il juge incomplets}} — {detailed}{rest}. Rien n’a été modifié dans n8n : corrige ces nœuds dans n8n (réassigne les credentials), puis resynchronise.',
    writeEffectDraft:
      "« {name} » n'a jamais été publié sur cette instance. La modification sera enregistrée comme brouillon : elle ne s'exécutera pas tant que le workflow n'est pas publié. Tu pourras le faire d'ici une fois le diff appliqué.",

    calleeArchived: 'archivé dans n8n : il ne se publie plus',
    calleeSelfStarting: 'a aussi un déclencheur {trigger} : le publier le mettrait en route',
    calleeStuck: "appelle {names}, à publier d'abord",
    calleeLocked: 'verrouillé : à publier à la main',
    calleeRefused: 'n8n a refusé de le publier : {error}',
    pubNoCounterpart: 'aucune contrepartie sur la cible',
    pubArchived: 'archivé dans n8n',
    pubRunNotFound: 'Chaîne de publication introuvable.',
    pubRunNotPaused: 'Cette chaîne n’est pas en pause.',
    pubRunRunning: 'Cette chaîne est déjà en cours.',
    pubStepLocked: 'verrouillé : lève le verrou pour le publier, ou passe l’étape',
    pubN8nRefused: 'n8n a refusé ({status}) : {detail}',
    pubNoDetail: 'aucun détail',

    pathNoKeeper: 'aucun exemplaire en env d’URL publique ni actif : impossible de savoir lequel garde l’URL',
    pathIdOnly:
      'URL tirée de l’identifiant du nœud, que n8n ne laisse pas modifier : recrée le nœud dans la copie',
    pathEnvUnknown: 'env indéterminé : nomme le workflow « - DEV » ou pose son tag env:*',
    pathSameTarget: 'plusieurs copies viseraient /{path} : donne-leur des paths distincts à la main',
    pathFixNone: 'Aucun workflow à corriger.',
    pathFixStale:
      "{count} workflow(s) ne sont plus dans le plan (état changé dans n8n ?) : relis le plan avant d'appliquer.",
    entryScheduled: 'planifié',
    entryError: "erreur d'un workflow",
    entryManual: 'lancé à la main',
    dynamicUrl: 'URL dynamique',

    versionNewOnTarget: "« {name} » n'existe pas encore sur la cible : il y arrive entier.",
    versionAiCapped:
      "{reason} (L'IA proposait une {proposed, select, major {majeure} minor {mineure} other {corrective}}, ramenée à {capped, select, major {majeure} minor {mineure} other {corrective}} : la règle n'y voit qu'une {rule, select, major {majeure} minor {mineure} other {corrective}}.)",
    versionReprise:
      "« {name} » n'a pas bougé depuis sa mise en service en {version} : la promotion reporte ce numéro, elle ne publie rien de neuf.",
    versionManualReprise: 'Reprise choisie à la main : le numéro de la source est reporté tel quel.',
    versionManualLevel: 'Niveau choisi à la main.',
    notSemver: "« {version} » n'est pas une version sémantique (attendu : 1.2.3).",

    promoteBlocked:
      'Promotion bloquée : {blockers}. Repasse les gates au vert (ou force en connaissance de cause).',
    promoteRemoteBlocked: 'Promotion de « {name} » bloquée : {reason}',
    freeUrlFailed: "Impossible de libérer l'URL tenue par « {holder} » : {error}. Rien n'a été promu.",
    rereadFailed:
      'Impossible de relire « {name} » dans n8n ({error}) : promotion abandonnée plutôt que de pousser un état périmé.',
    tableUnread: 'non lue',
    sameInstanceNoEnv:
      'Même instance sans env cible : le workflow s’écraserait lui-même. Choisis l’env vers lequel pousser.',
    alreadyThatExemplar: '« {name} » est déjà l’exemplaire {env} : pousser ici l’écraserait avec lui-même.',
    targetArchived:
      "« {name} » existe sur {instance} mais y est ARCHIVÉ : n8n refuse toute modification d'un workflow archivé. Désarchive-le dans n8n (ou renomme-le) avant de promouvoir.",
    gateFindings: '{count} finding(s) de sévérité error',
    gateTests: '{count} test(s) en échec',
    gateArchivedSubs:
      "{count} sous-workflow(s) archivé(s) sur la cible : {names} — désarchive-les dans n8n, un archivé ne s'exécute plus",
    gateUnknownSubs:
      "{count} sous-workflow(s) inconnu(s) de la plateforme (resynchronise l'instance source) : {names}",
    gateUncoveredSubs: '{count} sous-workflow(s) sans contrepartie sur la cible : {names}',
    gateEntryClash:
      "« {node} » : /{url} est déjà servi par « {holder} » (actif){hasMove, select, true { — coche « libérer l'URL » pour le passer en /{move}} other { — libère l'URL dans n8n}}",
    gateVersionAhead:
      "la cible porte {target} et la source {source} : la cible a reçu quelque chose que la source n'a pas — vérifie que tu n'écrases pas un correctif fait directement là-bas",
    noVersion: 'aucune version',
    chainBlockRefusal:
      "La chaîne d'environnements est en mode bloquant et cette promotion saute {skipped} : passe par {route}, ou coche « passer par les envs intermédiaires ».",
    chainWarnRefusal:
      'Cette promotion saute {skipped} (chaîne déclarée : {chain}). Confirme le saut explicitement, ou fais-la passer par les envs intermédiaires.',
    remoteSchemaBlocker:
      '{count} colonne(s) ou table(s) absente(s) sur la cible ({nodes}) — crée-les avant de promouvoir',
    chainGuardRefusal:
      "« {name} » est en {env}, et la chaîne d'environnements est en mode bloquant : un env aval ne se modifie qu'en y promouvant. Fais le changement en {upstream}, puis promeus.",

    groupDoubles:
      '{count} copie(s) portent déjà le nom cible ({names}) : dupliquer en créerait une seconde. Coche « dupliquer quand même » pour passer outre.',
    groupUnknown: 'Groupe {id} inconnu',
    groupEmpty: 'Le groupe ne contient aucun workflow',
  },
);
