import { N8nNode, N8nWorkflow } from './workflow.types';
import { paramLabel, paramString } from './n8n-params';
import { extractUrlHost, extractWebhookPath, workflowWebhookPaths } from './webhook-url';
import {
  WorkflowGraph,
  isManualTriggerNode,
  isStickyNote,
  isSubWorkflowTrigger,
  isTriggerNode,
} from './workflow-graph';

/**
 * Liens détectés dans le JSON n8n : `execute` = nœud Execute Workflow,
 * `tool` = sous-workflow outil d'un agent IA, `webhook` = HTTP Request
 * qui tape l'URL de webhook d'un autre workflow.
 */
export type WorkflowCallKind = 'execute' | 'tool' | 'webhook';

/** Appel sortant repéré sur un nœud, avant résolution de la cible. */
export interface WorkflowCall {
  nodeName: string;
  kind: WorkflowCallKind;
  /** Id n8n du workflow appelé (`execute` / `tool`), si écrit en dur. */
  targetN8nId?: string;
  /** Chemin de webhook appelé (`webhook`), à rapprocher des webhooks exposés. */
  targetWebhookPath?: string;
  /** URL complète appelée (`webhook`) : c'est elle qui porte l'instance visée. */
  targetUrl?: string;
  /** Nom lisible de la cible fourni par n8n (`cachedResultName`). */
  targetLabel?: string;
  /** D'où part l'appel dans le workflow appelant, quand ce n'est pas un flux ordinaire. */
  context?: { kind: CallContextKind; nodes: string[] };
}

/**
 * Contexte qui change la lecture de la flèche : `loop` = l'appel part une fois
 * par tour de boucle ; `manual` = son bout de workflow n'a qu'un trigger manuel
 * (bouton de test) ; `sub-workflow` = déclenché seulement par un parent
 * (Execute Workflow Trigger).
 */
export type CallContextKind = 'loop' | 'manual' | 'sub-workflow';

/** Workflow tel que stocké par la plateforme, suffisant pour résoudre les cibles. */
export interface LinkableWorkflow {
  id: string;
  externalId: string;
  name: string;
  raw: N8nWorkflow;
}

/** Lien workflow → workflow résolu (ou non, si la cible est hors périmètre). */
export interface AutoWorkflowLink {
  fromWorkflowId: string;
  /** Cible connue de la plateforme ; absent si le workflow appelé n'est pas synchronisé. */
  toWorkflowId?: string;
  /** Clé de la cible non résolue (`n8n:<id>` ou `webhook:<path>`). */
  unresolvedKey?: string;
  unresolvedLabel?: string;
  kind: WorkflowCallKind;
  nodeNames: string[];
  /**
   * Présent quand *tous* les nœuds à l'origine du lien partent du même type de contexte.
   * `nodeCount` = taille de ce bout de workflow (boucle, ou branche trigger comprise).
   */
  context?: { kind: CallContextKind; nodeCount: number };
}

/**
 * Bouts de workflow (composantes connexes, sens des liens ignoré) dont tous les
 * déclencheurs sont de même nature : rien n'en part sans un clic dans l'éditeur
 * (`manual`), ou sans qu'un workflow parent les appelle (`sub-workflow`).
 */
function branchContexts(
  workflow: N8nWorkflow,
  graph: WorkflowGraph,
): Map<string, { kind: CallContextKind; nodes: string[] }> {
  const nodes = (workflow.nodes ?? []).filter((node) => !isStickyNote(node));
  const byName = new Map(nodes.map((node) => [node.name, node]));
  const neighbours = new Map<string, Set<string>>(nodes.map((node) => [node.name, new Set()]));
  for (const edge of graph.edges) {
    neighbours.get(edge.from)?.add(edge.to);
    neighbours.get(edge.to)?.add(edge.from);
  }

  const contexts = new Map<string, { kind: CallContextKind; nodes: string[] }>();
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.name)) continue;
    const branch: string[] = [];
    const stack = [node.name];
    while (stack.length) {
      const current = stack.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      branch.push(current);
      stack.push(...(neighbours.get(current) ?? []));
    }
    const triggers = branch.map((name) => byName.get(name)!).filter((n) => isTriggerNode(n));
    // Un bout sans aucun trigger n'est ni manuel ni sous-workflow : il est simplement mort.
    if (triggers.length === 0) continue;
    const kind = triggers.every((n) => isManualTriggerNode(n))
      ? 'manual'
      : triggers.every((n) => isSubWorkflowTrigger(n))
        ? 'sub-workflow'
        : undefined;
    if (!kind) continue;
    for (const name of branch) contexts.set(name, { kind, nodes: branch });
  }
  return contexts;
}

/**
 * Boucles = composantes fortement connexes de plus d'un nœud (Tarjan) : Loop
 * Over Items rebouclé comme cycle tracé à la main. Nœud bouclé → nœuds du tour.
 */
function loopContexts(graph: WorkflowGraph): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const edge of graph.edges) {
    children.set(edge.from, [...(children.get(edge.from) ?? []), edge.to]);
  }

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const loops = new Map<string, string[]>();
  let counter = 0;

  // Tarjan itératif : un workflow n8n peut être profond, la récursion n'est pas garantie.
  for (const root of graph.nodeNames) {
    if (index.has(root)) continue;
    const work: Array<{ node: string; next: number }> = [{ node: root, next: 0 }];
    index.set(root, counter);
    low.set(root, counter++);
    stack.push(root);
    onStack.add(root);

    while (work.length) {
      const frame = work[work.length - 1];
      const successors = children.get(frame.node) ?? [];
      if (frame.next < successors.length) {
        const child = successors[frame.next++];
        if (!index.has(child)) {
          index.set(child, counter);
          low.set(child, counter++);
          stack.push(child);
          onStack.add(child);
          work.push({ node: child, next: 0 });
        } else if (onStack.has(child)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(child)!));
        }
        continue;
      }

      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!));
      if (low.get(frame.node) !== index.get(frame.node)) continue;

      const component: string[] = [];
      let current: string;
      do {
        current = stack.pop()!;
        onStack.delete(current);
        component.push(current);
      } while (current !== frame.node);
      if (component.length > 1) for (const name of component) loops.set(name, component);
    }
  }
  return loops;
}

function callsFromNode(node: N8nNode): WorkflowCall[] {
  if (node.disabled) return [];
  const p = node.parameters ?? {};
  const type = node.type.toLowerCase();

  // toolWorkflow avant executeWorkflow : `@n8n/n8n-nodes-langchain.toolWorkflow` ne contient
  // pas "executeworkflow", mais les deux portent le même paramètre workflowId.
  if (type.includes('toolworkflow') || type.includes('executeworkflow')) {
    const targetN8nId = paramString(p['workflowId']);
    if (!targetN8nId) return [];
    return [
      {
        nodeName: node.name,
        kind: type.includes('toolworkflow') ? 'tool' : 'execute',
        targetN8nId,
        targetLabel: paramLabel(p['workflowId']),
      },
    ];
  }

  if (type.includes('httprequest')) {
    const url = paramString(p['url']);
    const path = url ? extractWebhookPath(url) : null;
    if (path && url) {
      return [{ nodeName: node.name, kind: 'webhook', targetWebhookPath: path, targetUrl: url }];
    }
  }

  return [];
}

export function extractWorkflowCalls(workflow: N8nWorkflow): WorkflowCall[] {
  const graph = new WorkflowGraph(workflow);
  const branches = branchContexts(workflow, graph);
  const loops = loopContexts(graph);
  return (workflow.nodes ?? []).flatMap((node) =>
    callsFromNode(node).map((call) => {
      // La boucle prime : « part une fois par tour » se lit avant « part d'un bouton ».
      const loop = loops.get(node.name);
      const context = loop ? { kind: 'loop' as const, nodes: loop } : branches.get(node.name);
      return context ? { ...call, context } : call;
    }),
  );
}

/**
 * Résout les appels par id n8n puis par chemin de webhook, regroupés par
 * couple (appelant, cible, nature du lien).
 */
export function buildAutoWorkflowLinks(
  workflows: LinkableWorkflow[],
  /**
   * Hôtes des instances n8n connues de la plateforme. Un appel vers un hôte absent de
   * cette liste vise une autre installation : il n'est pas rapproché des webhooks locaux
   * (deux instances peuvent exposer le même chemin) et s'affiche avec son URL complète.
   */
  knownHosts: string[] = [],
): AutoWorkflowLink[] {
  const hosts = new Set(knownHosts.map((h) => h.toLowerCase()));
  const byN8nId = new Map(workflows.map((w) => [w.externalId, w]));
  const byWebhookPath = new Map<string, LinkableWorkflow>();
  for (const workflow of workflows) {
    for (const path of workflowWebhookPaths(workflow.raw)) {
      if (!byWebhookPath.has(path)) byWebhookPath.set(path, workflow);
    }
  }

  const links = new Map<string, AutoWorkflowLink>();
  // Contexte commun aux appelants d'un lien, ou `null` dès qu'ils divergent (ou qu'un
  // appelant part d'un flux ordinaire) : la flèche redevient un simple « appelle ».
  const contexts = new Map<string, { kind: CallContextKind; nodes: Set<string> } | null>();
  const add = (link: Omit<AutoWorkflowLink, 'nodeNames'>, call: WorkflowCall) => {
    const key = `${link.fromWorkflowId}>${link.toWorkflowId ?? link.unresolvedKey}:${link.kind}`;
    const context = contexts.get(key);
    if (!call.context || (context && context.kind !== call.context.kind)) contexts.set(key, null);
    else if (context !== null) {
      contexts.set(key, {
        kind: call.context.kind,
        nodes: new Set([...(context?.nodes ?? []), ...call.context.nodes]),
      });
    }

    const existing = links.get(key);
    if (existing) {
      if (!existing.nodeNames.includes(call.nodeName)) existing.nodeNames.push(call.nodeName);
      return;
    }
    links.set(key, { ...link, nodeNames: [call.nodeName] });
  };

  for (const workflow of workflows) {
    for (const call of extractWorkflowCalls(workflow.raw)) {
      // Un appel vers une autre installation n8n ne peut pas viser un workflow d'ici,
      // même si un des nôtres expose le même chemin de webhook.
      const host = call.targetUrl ? extractUrlHost(call.targetUrl) : null;
      const foreign = host !== null && hosts.size > 0 && !hosts.has(host.toLowerCase());

      const target =
        call.kind === 'webhook'
          ? call.targetWebhookPath && !foreign
            ? byWebhookPath.get(call.targetWebhookPath)
            : undefined
          : call.targetN8nId
            ? byN8nId.get(call.targetN8nId)
            : undefined;

      if (target) {
        // Les auto-appels sont conservés : une récursion est justement ce qu'on veut voir.
        add({ fromWorkflowId: workflow.id, toWorkflowId: target.id, kind: call.kind }, call);
        continue;
      }

      // Une cible sur une autre installation est identifiée par son URL entière : le seul
      // chemin ne dirait pas *où* ça tape, et deux installations peuvent le partager.
      const unresolvedKey =
        call.kind === 'webhook'
          ? `webhook:${foreign ? call.targetUrl : call.targetWebhookPath}`
          : `n8n:${call.targetN8nId}`;
      const unresolvedLabel =
        call.kind === 'webhook'
          ? foreign
            ? `${call.targetUrl}`
            : `webhook /${call.targetWebhookPath}`
          : // Un workflowId construit par expression ne désigne aucune cible connue à l'avance.
            (call.targetLabel ??
            (call.targetN8nId?.includes('{{')
              ? 'workflow choisi dynamiquement'
              : `workflow n8n #${call.targetN8nId}`));
      add({ fromWorkflowId: workflow.id, kind: call.kind, unresolvedKey, unresolvedLabel }, call);
    }
  }

  for (const [key, link] of links) {
    const context = contexts.get(key);
    if (context) link.context = { kind: context.kind, nodeCount: context.nodes.size };
  }

  return [...links.values()];
}
