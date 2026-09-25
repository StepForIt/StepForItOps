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

/** Ce que chaque outil va chercher, dit en français. */
const TOOL_LABELS: Record<string, string> = {
  read_node: 'Relecture d’un nœud',
  read_workflow: 'Lecture d’un sous-workflow appelé',
  create_sub_workflow: 'Création du sous-workflow',
  check_workflow: 'Vérification du brouillon',
  list_credentials: 'Lecture des credentials disponibles',
  describe_node_type: 'Lecture du schéma d’un type de nœud',
  search_node_types: 'Recherche d’un type de nœud',
  sync_workflow: 'Relecture du workflow depuis n8n',
  remember: 'Mémorisation d’un fait',
  list_conversations: 'Relecture des conversations passées',
  read_conversation: 'Relecture d’une conversation',
  find_examples: 'Recherche d’exemples dans les autres workflows',
  read_example_workflow: 'Lecture d’un workflow du parc',
  search_docs: 'Recherche de la documentation du service',
  read_docs: 'Lecture de la documentation du service',
  read_module: 'Relecture d’un module',
  check_scenario: 'Vérification du brouillon',
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
    label: TOOL_LABELS[name] ?? `Outil ${name}`,
    detail: toolSubject(input),
    done: false,
  };
}
