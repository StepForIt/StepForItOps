import { defineMessages } from '../catalog';

/** Étude d'impact : le niveau d'un workflow et ce qui le justifie. */
export const impact = defineMessages(
  {
    manifestName: 'Impact study',
    manifestDescription:
      'What touching a workflow commits to: callers, executions, exposed URLs, resources, with a named level',

    reasonLiveMonitored: 'Active in a monitored env: an error there is an incident',
    reasonActive: 'Active: it runs',
    reasonInactive: 'Inactive: nothing runs by itself',
    reasonCallers: 'Called by {count, plural, one {# workflow} other {# workflows}}: they break with it',
    reasonExecutions: '{count, plural, one {# execution} other {# executions}} in the last 30 days',
    reasonPublicEntry: '{count, plural, one {# public URL} other {# public URLs}} (webhook, form, chat)',
    reasonOpenErrors: '{count, plural, one {# open problem} other {# open problems}} already',
    reasonUnmapped:
      '{count, plural, one {# external resource} other {# external resources}} without env mapping',
    reasonRedTests: '{red} of {total} test cases red',

    safeguardTestsGreen: '{count, plural, one {# green test case} other {# green test cases}}',
    safeguardMonitors: 'Watched by {count, plural, one {# probe} other {# probes}}',
    safeguardLocked: 'Locked: no write without a justified override',

    noExemplar: 'No {env} exemplar: {role, select, write {it will be created} other {nothing to study}}',
    procedureNotFound: 'Procedure not found',
    workflowNotFound: 'Workflow not found',
    tooMany: 'At most {max} workflows per study',
  },
  {
    manifestName: "Étude d'impact",
    manifestDescription:
      "Ce qu'engage une modification d'un workflow : appelants, exécutions, URL exposées, ressources, avec un niveau nommé",

    reasonLiveMonitored: 'Actif dans un env surveillé : une erreur y est un incident',
    reasonActive: 'Actif : il tourne',
    reasonInactive: 'Inactif : rien ne tourne tout seul',
    reasonCallers: 'Appelé par {count, plural, one {# workflow} other {# workflows}} : ils cassent avec lui',
    reasonExecutions: '{count, plural, one {# exécution} other {# exécutions}} sur les 30 derniers jours',
    reasonPublicEntry:
      '{count, plural, one {# URL publique} other {# URL publiques}} (webhook, formulaire, chat)',
    reasonOpenErrors: 'Déjà {count, plural, one {# problème ouvert} other {# problèmes ouverts}}',
    reasonUnmapped:
      "{count, plural, one {# ressource externe} other {# ressources externes}} sans mapping d'env",
    reasonRedTests: '{red} cas de test sur {total} au rouge',

    safeguardTestsGreen: '{count, plural, one {# cas de test au vert} other {# cas de test au vert}}',
    safeguardMonitors: 'Surveillé par {count, plural, one {# sonde} other {# sondes}}',
    safeguardLocked: 'Verrouillé : aucune écriture sans forçage justifié',

    noExemplar: 'Aucun exemplaire {env} : {role, select, write {il sera créé} other {rien à étudier}}',
    procedureNotFound: 'Procédure introuvable',
    workflowNotFound: 'Workflow introuvable',
    tooMany: 'Au plus {max} workflows par étude',
  },
);
