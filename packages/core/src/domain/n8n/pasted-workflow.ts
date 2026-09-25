/**
 * Le JSON n8n collé dans un message : une BASE, pas une illustration.
 *
 * D'où ça vient : coller le JSON d'un nœud ou d'un fragment de workflow est la
 * façon la plus rapide de dire « pars de ça ». Le modèle, lui, le lisait comme
 * une description et reconstruisait à sa façon — un IF disparaissait, une boucle
 * changeait de câblage, et il fallait deux tours pour retrouver ce qui était
 * pourtant écrit noir sur blanc dans la demande.
 *
 * Ce qu'on en tire est volontairement maigre : la LISTE de ce qui a été collé
 * (nœuds, types, câblage), de quoi rappeler au modèle ce qu'il doit conserver.
 * Le JSON lui-même reste dans le message — c'est lui qui fait foi.
 *
 * Pur : aucune IO, aucune dépendance au reste de la plateforme.
 */

import { N8nWorkflow } from './workflow.types';
import { WorkflowGraph } from './workflow-graph';

export interface PastedWorkflow {
  nodes: Array<{ name: string; type: string; typeVersion?: number }>;
  /** Câblage, une ligne par arête (« A → B », sortie précisée si ce n'est pas la première). */
  edges: string[];
  /** Des données épinglées : c'est un extrait pris sur une exécution réelle. */
  hasPinData: boolean;
}

/** Au-delà, on ne cherche pas : un message de cette taille n'est plus un collage. */
const MAX_TEXT = 400_000;
/** Un objet JSON plus court que ça ne peut pas porter un nœud n8n. */
const MIN_CANDIDATE = 40;

/**
 * Objets JSON de premier niveau du texte, blocs markdown compris (les backticks
 * n'entrent pas dans le compte des accolades). Balayage unique, chaînes et
 * échappements respectés : sans ça, une accolade dans un prompt fausse tout.
 */
function topLevelObjects(text: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (char === '}') {
      if (depth === 0) continue; // Accolade fermante orpheline : on repart à plat.
      depth -= 1;
      if (depth === 0 && start >= 0) {
        if (i - start >= MIN_CANDIDATE) found.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return found;
}

/** Le JSON porte-t-il des nœuds n8n ? */
function asWorkflow(value: unknown): N8nWorkflow | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<N8nWorkflow>;
  if (!Array.isArray(candidate.nodes) || candidate.nodes.length === 0) return null;
  const nodes = candidate.nodes.filter(
    (node) =>
      node && typeof node === 'object' && typeof node.type === 'string' && typeof node.name === 'string',
  );
  if (nodes.length === 0) return null;
  return { name: '', nodes, connections: candidate.connections ?? {}, pinData: candidate.pinData };
}

/**
 * Les fragments de workflow n8n collés dans un texte. Vide quand il n'y en a
 * pas — c'est le cas courant, et rien ne doit alors être ajouté au tour.
 */
export function findPastedWorkflows(text: string): PastedWorkflow[] {
  if (!text || text.length > MAX_TEXT || !text.includes('"nodes"')) return [];
  const pasted: PastedWorkflow[] = [];
  for (const candidate of topLevelObjects(text)) {
    if (!candidate.includes('"nodes"')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue; // Un JSON tronqué au copier-coller n'est pas une base : on l'ignore.
    }
    const workflow = asWorkflow(parsed);
    if (!workflow) continue;
    const graph = new WorkflowGraph(workflow);
    pasted.push({
      nodes: workflow.nodes.map((node) => ({
        name: node.name,
        type: node.type,
        ...(node.typeVersion !== undefined ? { typeVersion: node.typeVersion } : {}),
      })),
      edges: graph.edges.map(
        (edge) =>
          `${edge.from} → ${edge.to}` +
          (edge.outputType !== 'main' ? ` [${edge.outputType}]` : '') +
          (edge.outputIndex > 0 ? ` (sortie ${edge.outputIndex})` : ''),
      ),
      hasPinData: Boolean(workflow.pinData && Object.keys(workflow.pinData).length > 0),
    });
  }
  return pasted;
}

/**
 * La consigne à joindre au tour quand l'utilisateur a collé du JSON n8n. Elle
 * nomme ce qui a été collé : le modèle résume et paraphrase, et ce qu'il ne
 * nomme pas est ce qu'il laisse tomber.
 */
export function pastedWorkflowBrief(pasted: PastedWorkflow[]): string {
  if (pasted.length === 0) return '';
  const lines = pasted.flatMap((fragment, index) => {
    const title = pasted.length > 1 ? `Fragment ${index + 1} :` : 'Fragment collé :';
    return [
      title,
      ...fragment.nodes.map(
        (node) => `- « ${node.name} » (${node.type}${node.typeVersion ? ` v${node.typeVersion}` : ''})`,
      ),
      ...(fragment.edges.length ? [`- câblage : ${fragment.edges.join(' ; ')}`] : []),
      ...(fragment.hasPinData ? ['- porte des données épinglées (extrait d’une exécution réelle)'] : []),
    ];
  });
  return [
    'L’utilisateur a COLLÉ du JSON n8n dans son message. C’est la base de départ qu’il a choisie,',
    'pas une illustration : il sait ce qu’il veut, il te donne le point de départ exact.',
    ...lines,
    '',
    'Ce que ça implique :',
    '- Pars de ce JSON tel qu’il est écrit. Reprends les paramètres, les prompts et le câblage',
    '  VERBATIM ; tu n’as pas à les réécrire « en mieux », ni à les résumer.',
    '- Tout nœud du fragment se retrouve dans ta proposition. Un IF, un Switch, une boucle collés',
    '  se reproduisent avec leurs sorties : en perdre un, c’est perdre l’intention.',
    '- Tu ADAPTES seulement ce que ce workflow-ci impose : noms de nœuds référencés par les',
    '  expressions, credentials de l’instance (list_credentials), ids et urls d’ici, typeVersion',
    '  servie par l’instance. Dis en une ligne ce que tu as adapté, et pourquoi.',
    '- Ce que tu voudrais changer d’autre se PROPOSE à côté, en une ligne, jamais en le faisant',
    '  d’office dans le diff.',
    '- Les données épinglées ne se recopient pas : elles servent à comprendre la forme attendue.',
  ].join('\n');
}
