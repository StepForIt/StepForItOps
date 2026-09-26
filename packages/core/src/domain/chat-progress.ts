/**
 * Ce que l'assistant est en train de faire, pendant qu'il le fait.
 *
 * Un tour enchaîne la relecture du workflow dans n8n, la construction du
 * contexte, puis plusieurs allers-retours d'outils : une minute d'attente
 * derrière une seule ligne « l'assistant analyse le workflow… », où rien ne
 * bouge et où l'on ne sait pas distinguer un travail en cours d'un tour perdu.
 * La trace des outils existe déjà, mais elle n'arrive qu'AVEC la réponse.
 *
 * Les libellés sont calculés ici, donc côté domaine : le web n'a pas accès à
 * `@nwm/core`, et un nom d'outil brut (`check_workflow`) ne se montre pas.
 */

import { MessageId, msg } from '../i18n';

export interface TurnProgressStep {
  /** Libellé court, prêt à afficher. */
  label: string;
  /** Ce sur quoi porte l'étape : nom de nœud, type visé, requête. */
  detail?: string;
  /** Terminée ? La dernière étape non terminée porte le spinner. */
  done: boolean;
  failed?: boolean;
}

export interface TurnProgress {
  /** Début du tour, pour afficher le temps écoulé. */
  startedAt: string;
  steps: TurnProgressStep[];
  /** Le tour est-il encore en cours ? Faux dès que la réponse est écrite. */
  running: boolean;
}

/** Ce que chaque outil va chercher, dit dans la langue de l'écran. */
const TOOL_LABELS: Record<string, MessageId> = {
  read_node: 'chat.progressReadNode',
  read_workflow: 'chat.progressReadWorkflow',
  create_sub_workflow: 'chat.progressCreateSubWorkflow',
  check_workflow: 'chat.progressCheckDraft',
  list_credentials: 'chat.progressListCredentials',
  describe_node_type: 'chat.progressDescribeNodeType',
  read_node_docs: 'chat.progressReadNodeDocs',
  search_node_types: 'chat.progressSearchNodeTypes',
  sync_workflow: 'chat.progressSyncWorkflow',
  remember: 'chat.progressRemember',
  list_conversations: 'chat.progressListConversations',
  read_conversation: 'chat.progressReadConversation',
  find_examples: 'chat.progressFindExamples',
  read_example_workflow: 'chat.progressReadExampleWorkflow',
  search_docs: 'chat.progressSearchDocs',
  read_docs: 'chat.progressReadDocs',
  read_module: 'chat.progressReadModule',
  check_scenario: 'chat.progressCheckDraft',
};

/** L'argument qui identifie l'appel — le nœud visé, le type, la requête. */
function toolSubject(input: Record<string, unknown>): string | undefined {
  // Make désigne un module par son id entier, jamais par un nom.
  if (typeof input?.moduleId === 'number') return `module #${input.moduleId}`;
  for (const key of [
    'node',
    'nodeType',
    'library',
    'topic',
    'libraryId',
    'query',
    'fact',
    'sessionId',
    'workflow',
  ]) {
    const value = input?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/** Étape d'un appel d'outil, telle qu'elle s'affiche pendant qu'il tourne. */
export function toolProgressStep(name: string, input: Record<string, unknown>): TurnProgressStep {
  return {
    label: TOOL_LABELS[name] ? msg(TOOL_LABELS[name]) : msg('chat.progressUnknownTool', { name }),
    detail: toolSubject(input),
    done: false,
  };
}
