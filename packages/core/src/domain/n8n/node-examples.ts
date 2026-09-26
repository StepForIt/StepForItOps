/**
 * Le parc de workflows lu comme une base d'exemples.
 *
 * D'où ça vient : l'assistant ne voyait du parc que des statistiques de forme
 * (`param-shape`) et la liste des credentials. Il ne pouvait pas répondre à
 * « comment on branche notre NocoDB, ici », ni recopier un montage éprouvé, ni
 * découvrir qu'un NoOp « Start » est la convention de la maison. Il écrivait
 * donc du n8n générique dans une maison qui a ses habitudes — alors que la
 * réponse est déjà écrite, dans les autres workflows.
 *
 * TOUTES instances confondues, volontairement : une convention posée en dev sur
 * une instance vaut pour la prod d'une autre, et c'est même là qu'un exemple est
 * le plus utile — le workflow qu'on vient promouvoir n'a rien à copier chez lui.
 *
 * Pur (aucun IO) : le corpus est chargé par l'appelant, et les paramètres rendus
 * ont été débarrassés de leurs secrets — un exemple est un montage, pas un
 * trousseau.
 */

import { activeParameters } from './inert-params';
import { redactSecrets } from '../secret-patterns';
import { N8nNode, N8nWorkflow } from './workflow.types';
import { WorkflowGraph, isStickyNote, isTriggerNode } from './workflow-graph';

/** Un workflow du parc, tel que l'appelant l'a chargé. */
export interface ExampleWorkflow {
  /** Id plateforme, pour écarter le workflow de la conversation en cours. */
  id: string;
  name: string;
  instance: string;
  /** Sert au classement : la convention la plus fraîche passe devant. */
  updatedAt: Date;
  raw: N8nWorkflow;
}

/** Un nœud d'ailleurs, prêt à être montré. */
export interface NodeExample {
  workflow: string;
  instance: string;
  nodeName: string;
  nodeType: string;
  typeVersion?: number;
  /** Noms des credentials rattachées (jamais leurs valeurs). */
  credentials: string[];
  notes?: string;
  parameters: Record<string, unknown>;
  /** Clés retirées faute de place, nommées plutôt que disparues en silence. */
  parametersOmitted?: string[];
  /** Ce qui précède et ce qui suit : un nœud isolé ne montre pas le montage. */
  upstream: string[];
  downstream: string[];
  /** Nombre de nœuds du parc identiques à celui-ci (même type, mêmes paramètres). */
  duplicates: number;
}

export interface ExampleSearch {
  /** Type n8n exact. Le critère le plus sûr : « comment on configure un Slack ». */
  nodeType?: string;
  /** Recherche libre, sur le type, le nom du nœud, celui du workflow et les paramètres. */
  query?: string;
  /** Workflow à exclure : celui de la conversation ne s'apprend rien à lui-même. */
  excludeWorkflowId?: string;
  limit?: number;
}

export interface ExampleResult {
  /** Nœuds trouvés dans tout le parc, avant plafonnement. */
  total: number;
  /** Workflows distincts où ils vivent. */
  workflows: number;
  examples: NodeExample[];
}

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
/**
 * Exemples pris dans un même workflow. Sans ce plafond, un workflow qui aligne
 * huit nœuds HTTP remplit la réponse à lui seul, et l'assistant croit tenir la
 * convention de la maison alors qu'il tient l'habitude d'un seul auteur.
 */
const MAX_PER_WORKFLOW = 2;
/** Budget de sérialisation des paramètres d'un exemple. */
const MAX_PARAM_CHARS = 2_000;
/**
 * Budget d'un nœud IA. Plus large parce que, sur ces nœuds-là, le prompt EST le
 * montage : c'est la seule chose qui s'apprend d'un exemple.
 */
const MAX_PROMPT_PARAM_CHARS = 6_000;
/** Au-delà, un prompt est coupé plutôt que retiré : sa structure se lit sur son début. */
const MAX_PROMPT_CHARS = 3_000;

/** Nœud dont le paramètre principal est un prompt (LangChain, chat models, agents). */
function isPromptNode(node: N8nNode): boolean {
  const type = node.type.toLowerCase();
  return type.includes('langchain') || type.includes('openai') || type.includes('anthropic');
}

/**
 * Clés qui portent un prompt. Elles ne sont JAMAIS retirées : l'élagage sortait
 * la plus grosse clé d'abord, donc systématiquement le prompt — l'assistant
 * recevait des exemples de nœuds IA dont la seule partie instructive manquait,
 * et écrivait ses prompts de mémoire.
 */
const PROMPT_KEYS = new Set([
  'text',
  'prompt',
  'messages',
  'responses',
  'systemMessage',
  'instructions',
  'toolDescription',
  'jsonSchemaExample',
]);

/** Coupe les longues chaînes d'un arbre, en le disant sur place. */
function truncateStrings(value: unknown, max: number): unknown {
  if (typeof value === 'string') {
    return value.length > max ? `${value.slice(0, max)}… [truncated, ${value.length} characters]` : value;
  }
  if (Array.isArray(value)) return value.map((item) => truncateStrings(item, max));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        truncateStrings(item, max),
      ]),
    );
  }
  return value;
}

/** Texte où une recherche libre va chercher ses mots. */
function searchableText(node: N8nNode, workflow: ExampleWorkflow): string {
  return [node.name, node.type, workflow.name, JSON.stringify(node.parameters ?? {})].join(' ').toLowerCase();
}

/** Tous les mots de la requête doivent être présents : « slack message » ne rend pas tout Slack. */
function matchesQuery(text: string, words: string[]): boolean {
  return words.every((word) => text.includes(word));
}

/**
 * Paramètres rendus : secrets masqués, et coupés s'ils dépassent le budget.
 * Les plus grosses clés partent d'abord — corps HTML, gros contenu, rien qui
 * apprenne le montage. Sauf sur un nœud IA, où la plus grosse clé est le prompt,
 * c'est-à-dire la seule chose qu'on vienne y chercher : là, on coupe sans retirer.
 */
function renderParameters(node: N8nNode): Pick<NodeExample, 'parameters' | 'parametersOmitted'> {
  const parameters = redactSecrets(activeParameters(node)) as Record<string, unknown>;
  const prompts = isPromptNode(node);
  const budget = prompts ? MAX_PROMPT_PARAM_CHARS : MAX_PARAM_CHARS;
  const omitted: string[] = [];
  let kept: Record<string, unknown> = { ...parameters };
  // Le prompt est coupé AVANT que quoi que ce soit ne soit retiré : mieux vaut
  // un prompt tronqué, dont la structure se lit, que le reste du nœud sans lui.
  if (prompts && JSON.stringify(kept).length > budget) {
    kept = truncateStrings(kept, MAX_PROMPT_CHARS) as Record<string, unknown>;
  }
  while (JSON.stringify(kept).length > budget) {
    const droppable = Object.entries(kept).filter(([key]) => !(prompts && PROMPT_KEYS.has(key)));
    const biggest = droppable.sort((a, b) => JSON.stringify(b[1]).length - JSON.stringify(a[1]).length)[0];
    if (!biggest) break;
    delete kept[biggest[0]];
    omitted.push(biggest[0]);
  }
  return { parameters: kept, ...(omitted.length ? { parametersOmitted: omitted } : {}) };
}

/** Signature d'un nœud : deux copies du même montage ne comptent que pour un exemple. */
function signatureOf(node: N8nNode): string {
  return `${node.type}:${JSON.stringify(activeParameters(node))}`;
}

/**
 * Les nœuds du parc qui répondent à la recherche, du plus récemment touché au
 * plus ancien, dédoublonnés et répartis entre workflows.
 */
export function findNodeExamples(corpus: ExampleWorkflow[], search: ExampleSearch): ExampleResult {
  const nodeType = search.nodeType?.trim().toLowerCase();
  const words = (search.query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 1);
  if (!nodeType && words.length === 0) return { total: 0, workflows: 0, examples: [] };

  const limit = Math.min(search.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  // Le plus récent d'abord : à conventions contradictoires, la dernière écrite
  // est celle qu'on veut voir reproduite.
  const sources = [...corpus]
    .filter((workflow) => workflow.id !== search.excludeWorkflowId)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  const examples: NodeExample[] = [];
  const bySignature = new Map<string, NodeExample>();
  const perWorkflow = new Map<string, number>();
  const workflowsSeen = new Set<string>();
  let total = 0;

  for (const workflow of sources) {
    const graph = new WorkflowGraph(workflow.raw);
    for (const node of workflow.raw.nodes ?? []) {
      // Les sticky notes n'ont pas de montage ; un nœud désactivé n'est pas un
      // modèle : il n'a pas tourné, personne n'a vérifié qu'il tenait.
      if (isStickyNote(node) || node.disabled) continue;
      if (nodeType && node.type.toLowerCase() !== nodeType) continue;
      if (words.length > 0 && !matchesQuery(searchableText(node, workflow), words)) continue;

      total += 1;
      workflowsSeen.add(workflow.id);

      const signature = signatureOf(node);
      const known = bySignature.get(signature);
      if (known) {
        known.duplicates += 1;
        continue;
      }
      if (examples.length >= limit) continue;
      if ((perWorkflow.get(workflow.id) ?? 0) >= MAX_PER_WORKFLOW) continue;

      const example: NodeExample = {
        workflow: workflow.name,
        instance: workflow.instance,
        nodeName: node.name,
        nodeType: node.type,
        ...(node.typeVersion !== undefined ? { typeVersion: node.typeVersion } : {}),
        credentials: Object.values(node.credentials ?? {}).map((c) => c.name ?? c.id ?? '?'),
        ...(node.notes ? { notes: node.notes } : {}),
        ...renderParameters(node),
        upstream: [...graph.parentsOf(node.name)],
        downstream: [...graph.childrenOf(node.name)],
        duplicates: 0,
      };
      examples.push(example);
      bySignature.set(signature, example);
      perWorkflow.set(workflow.id, (perWorkflow.get(workflow.id) ?? 0) + 1);
    }
  }

  return { total, workflows: workflowsSeen.size, examples };
}

/** Le squelette d'un workflow : ce qu'il enchaîne, sans le détail des paramètres. */
export interface WorkflowSkeleton {
  name: string;
  instance: string;
  active: boolean;
  nodes: Array<{ name: string; type: string; disabled?: boolean; notes?: string; trigger?: boolean }>;
  /** Câblage, une ligne par arête (« A → B », sortie précisée si ce n'est pas la première). */
  edges: string[];
  orphans: string[];
}

/**
 * Un workflow d'ailleurs, montré pour son MONTAGE et non pour ses valeurs :
 * l'enchaînement des nœuds tient en quelques lignes, là où son JSON complet
 * pèserait plus que le workflow dont on parle. Les paramètres se demandent
 * ensuite, nœud par nœud.
 */
export function workflowSkeleton(workflow: ExampleWorkflow): WorkflowSkeleton {
  const raw = workflow.raw;
  const graph = new WorkflowGraph(raw);
  return {
    name: workflow.name,
    instance: workflow.instance,
    active: Boolean(raw.active),
    nodes: (raw.nodes ?? [])
      .filter((node) => !isStickyNote(node))
      .map((node) => ({
        name: node.name,
        type: node.type,
        ...(node.disabled ? { disabled: true } : {}),
        ...(node.notes ? { notes: node.notes } : {}),
        ...(isTriggerNode(node) ? { trigger: true } : {}),
      })),
    edges: graph.edges.map(
      (edge) =>
        `${edge.from} → ${edge.to}` +
        (edge.outputType !== 'main' ? ` [${edge.outputType}]` : '') +
        (edge.outputIndex > 0 ? ` (output ${edge.outputIndex})` : ''),
    ),
    orphans: graph.orphanNodes(),
  };
}
