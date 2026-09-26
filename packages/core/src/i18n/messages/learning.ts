import { defineMessages } from '../catalog';

export const learning = defineMessages(
  {
    reasonExampleValue:
      'Example value set by the assistant at {path}, replaced by hand: to be confirmed as a mistake (an invented value) rather than a business choice.',
    reasonValueChange: 'Value changed at {path}: a fact specific to this workflow, not a rule.',
    reasonNodeAdded:
      'Node "{name}" ({type}) added by hand after the proposal: was it missing from what the assistant proposed, or is it something else?',
    reasonShapeFixed:
      "The SHAPE of {path} was corrected: the assistant had not followed what the node's schema declares.",
    reasonSettingFixed: 'Setting "{field}" corrected by hand on "{name}".',
    reasonNodeRemoved:
      'Node "{name}" ({type}) removed after the proposal: was it one too many, or did the need change?',
    reasonWiringRedone:
      'The wiring was redone by hand on nodes the proposal touched: misunderstood setup, or change of mind?',
    valueRemoved: '(removed)',
    wiringProposed: '(proposed wiring)',
    wiringFixed: '(corrected wiring)',
    question:
      '{reason}{others, plural, =0 {} one { (# other point not included)} other { (# other points not included)}}',
    moduleName: 'Self-learning assistant',
    moduleDescription: 'The assistant learns from corrections made by hand',
  },
  {
    reasonExampleValue:
      "Valeur d'exemple posée par l'assistant en {path}, remplacée à la main : à confirmer comme erreur (une valeur inventée) plutôt que comme choix métier.",
    reasonValueChange: 'Changement de valeur en {path} : un fait propre à ce workflow, pas une règle.',
    reasonNodeAdded:
      'Nœud "{name}" ({type}) ajouté à la main après la proposition : manquait-il à ce que l\'assistant a proposé, ou est-ce autre chose ?',
    reasonShapeFixed:
      "La FORME de {path} a été corrigée : ce que le schéma du nœud déclare, l'assistant ne l'avait pas respecté.",
    reasonSettingFixed: 'Réglage "{field}" corrigé à la main sur "{name}".',
    reasonNodeRemoved:
      'Nœud "{name}" ({type}) supprimé après la proposition : était-il de trop, ou le besoin a-t-il changé ?',
    reasonWiringRedone:
      "Le câblage a été refait à la main sur des nœuds que la proposition touchait : montage mal compris, ou changement d'avis ?",
    valueRemoved: '(supprimé)',
    wiringProposed: '(câblage proposé)',
    wiringFixed: '(câblage corrigé)',
    question:
      '{reason}{others, plural, =0 {} one { (# autre point non repris)} other { (# autres points non repris)}}',
    moduleName: 'Assistant auto-apprenant',
    moduleDescription: "L'assistant apprend des corrections faites à la main",
  },
);
