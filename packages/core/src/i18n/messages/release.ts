import { defineMessages } from '../catalog';

/** Procédures de mise en ligne : enregistrement, édition, rejeu. */
export const release = defineMessages(
  {
    manifestName: 'Release procedures',
    manifestDescription: 'Records the gestures of a release and replays them towards the next env',

    stepPublish: 'Publish {name}{hasEnv, select, true { in {env}} other {}}',
    stepGesture:
      '{action, select, promote {Promote} mark {Declare} duplicate {Duplicate} switch {Rewire} other {Run the tests of}} {name}{hasTarget, select, true { {action, select, mark {as} switch {onto} other {to}} {target}} other {}}',

    reorderMismatch: 'The order must list exactly the steps of the procedure',
    frozenSteps: 'Steps already played no longer move',
    unknownGesture: 'Unknown gesture',
    pickWorkflow: 'Choose a workflow',
    envNotDeclared: 'Env {env} not declared',
    pickTargetEnv: 'Choose a target env',
    pickSourceEnv: 'Choose a starting env',
    pickTwoEnvs: 'Choose two different envs',

    procedureNotFound: 'Procedure not found',
    nameRequired: 'Name is required',
    recordingInProgress: 'Recording in progress: stop it first',
    noHopRecorded: 'No promotion recorded: nothing to shift',
    sameHop: 'Same hop as the original',
    sayWhatToDo: 'Say what needs to be done',
    stepNotFound: 'Step not found',
    gestureLabelDerived: 'The label of a gesture is derived from the gesture',
    notAGesture: 'This is not a gesture',
    noExemplar: 'No {env} exemplar of this workflow',
  },
  {
    manifestName: 'Procédures de mise en ligne',
    manifestDescription: "Enregistre les gestes d'une mise en ligne et les rejoue vers l'env suivant",

    stepPublish: 'Publier {name}{hasEnv, select, true { en {env}} other {}}',
    stepGesture:
      '{action, select, promote {Promouvoir} mark {Déclarer} duplicate {Dupliquer} switch {Rebrancher} other {Jouer les tests de}} {name}{hasTarget, select, true { {action, select, mark {en} switch {sur} other {vers}} {target}} other {}}',

    reorderMismatch: "L'ordre doit reprendre exactement les étapes de la procédure",
    frozenSteps: 'Les étapes déjà jouées ne bougent plus',
    unknownGesture: 'Geste inconnu',
    pickWorkflow: 'Choisis un workflow',
    envNotDeclared: 'Env {env} non déclaré',
    pickTargetEnv: 'Choisis un env cible',
    pickSourceEnv: 'Choisis un env de départ',
    pickTwoEnvs: 'Choisis deux envs différents',

    procedureNotFound: 'Procédure introuvable',
    nameRequired: 'Nom obligatoire',
    recordingInProgress: 'Enregistrement en cours : arrête-le avant',
    noHopRecorded: 'Aucune promotion enregistrée : rien à décaler',
    sameHop: "Même saut que l'originale",
    sayWhatToDo: "Dis ce qu'il y a à faire",
    stepNotFound: 'Étape introuvable',
    gestureLabelDerived: "Le libellé d'un geste se déduit du geste",
    notAGesture: "Ce n'est pas un geste",
    noExemplar: 'Aucun exemplaire {env} de ce workflow',
  },
);
