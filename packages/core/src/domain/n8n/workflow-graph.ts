import { N8nWorkflow } from './workflow.types';

export interface GraphEdge {
  from: string;
  to: string;
  outputType: string;
  outputIndex: number;
}

/** Vue graphe d'un workflow n8n : arêtes aplaties + index d'adjacence. */
export class WorkflowGraph {
  readonly nodeNames: Set<string>;
  /** Arêtes réelles : les deux extrémités existent dans `nodes`. */
  readonly edges: GraphEdge[] = [];
  /**
   * Connexions résiduelles dont une extrémité n'existe plus (nœud supprimé sans
   * nettoyage du bloc `connections`, typiquement une écriture par l'API n8n).
   * n8n les ignore — éditeur comme exécution : elles ne sont pas des arêtes.
   */
  readonly danglingEdges: GraphEdge[] = [];
  private readonly parents = new Map<string, Set<string>>();
  private readonly children = new Map<string, Set<string>>();

  constructor(readonly workflow: N8nWorkflow) {
    // `nodes` peut manquer : JSON tronqué, ou contenu d'une autre plateforme passé ici
    // par erreur. Un graphe vide se lit ; un TypeError emporte la page entière.
    this.nodeNames = new Set((workflow?.nodes ?? []).map((n) => n.name));
    for (const [from, byType] of Object.entries(workflow?.connections ?? {})) {
      for (const [outputType, outputs] of Object.entries(byType ?? {})) {
        (outputs ?? []).forEach((targets, outputIndex) => {
          for (const target of targets ?? []) {
            const edge = { from, to: target.node, outputType, outputIndex };
            if (!this.nodeNames.has(from) || !this.nodeNames.has(target.node)) {
              this.danglingEdges.push(edge);
              continue;
            }
            this.edges.push(edge);
            if (!this.parents.has(target.node)) this.parents.set(target.node, new Set());
            this.parents.get(target.node)!.add(from);
            if (!this.children.has(from)) this.children.set(from, new Set());
            this.children.get(from)!.add(target.node);
          }
        });
      }
    }
  }

  /** Parents directs d'un nœud (nœuds dont il consomme la sortie). */
  parentsOf(nodeName: string): Set<string> {
    return new Set(this.parents.get(nodeName) ?? []);
  }

  /** Tous les ancêtres (directs et transitifs) d'un nœud. */
  ancestorsOf(nodeName: string): Set<string> {
    const seen = new Set<string>();
    const stack = [...(this.parents.get(nodeName) ?? [])];
    while (stack.length) {
      const current = stack.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      stack.push(...(this.parents.get(current) ?? []));
    }
    return seen;
  }

  /** Enfants directs d'un nœud (nœuds qui consomment sa sortie). */
  childrenOf(nodeName: string): Set<string> {
    return new Set(this.children.get(nodeName) ?? []);
  }

  /** Tous les descendants (directs et transitifs) d'un nœud. */
  descendantsOf(nodeName: string): Set<string> {
    return this.reach(this.children.get(nodeName) ?? new Set());
  }

  /** Nœuds atteignables depuis une sortie précise d'un nœud (branche d'un IF/Switch). */
  reachableFromOutput(nodeName: string, outputType: string, outputIndex: number): Set<string> {
    const targets = this.edges
      .filter((e) => e.from === nodeName && e.outputType === outputType && e.outputIndex === outputIndex)
      .map((e) => e.to);
    return this.reach(targets);
  }

  /** Indices de sortie (d'un type donné) de `nodeName` par lesquels `target` est atteignable. */
  outputsReaching(nodeName: string, target: string, outputType = 'main'): number[] {
    const indexes = new Set(
      this.edges.filter((e) => e.from === nodeName && e.outputType === outputType).map((e) => e.outputIndex),
    );
    return [...indexes]
      .filter((index) => this.reachableFromOutput(nodeName, outputType, index).has(target))
      .sort((a, b) => a - b);
  }

  /** Parcours en largeur sans retour sur ses pas : les boucles n8n ne le font pas tourner. */
  private reach(from: Iterable<string>): Set<string> {
    const seen = new Set<string>();
    const stack = [...from];
    while (stack.length) {
      const current = stack.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      stack.push(...(this.children.get(current) ?? []));
    }
    return seen;
  }

  /** Nœuds sans aucune connexion entrante ni sortante (sticky notes exclues : jamais connectées par design). */
  orphanNodes(): string[] {
    const connected = new Set<string>();
    for (const e of this.edges) {
      connected.add(e.from);
      connected.add(e.to);
    }
    return this.workflow.nodes
      .filter((node) => !connected.has(node.name) && !isStickyNote(node))
      .map((node) => node.name);
  }
}

/** Les sticky notes sont des annotations visuelles : à ignorer dans toutes les analyses. */
export function isStickyNote(node: { type: string }): boolean {
  return node.type.toLowerCase().includes('stickynote');
}

const TRIGGER_TYPE_HINTS = ['trigger', 'webhook', 'cron', 'start', 'evaluationtrigger'];

/** `respondToWebhook` contient « webhook » mais répond à une exécution : il n'en démarre aucune. */
const TRIGGER_TYPE_EXCLUSIONS = ['respondtowebhook'];

/** Nœud qui démarre une exécution (trigger, webhook, cron…). */
export function isTriggerNode(node: { type: string }): boolean {
  const type = node.type.toLowerCase();
  if (TRIGGER_TYPE_EXCLUSIONS.some((hint) => type.includes(hint))) return false;
  return TRIGGER_TYPE_HINTS.some((hint) => type.includes(hint));
}

/** Trigger actionné à la main dans l'éditeur n8n (bouton « Execute workflow »). */
export function isManualTriggerNode(node: { type: string }): boolean {
  const type = node.type.toLowerCase();
  return type.includes('manualtrigger') || type === 'n8n-nodes-base.start';
}

/** Trigger « When Executed by Another Workflow » : le workflow est appelé, il ne part pas seul. */
export function isSubWorkflowTrigger(node: { type: string }): boolean {
  return node.type.toLowerCase().includes('executeworkflowtrigger');
}

/** Façons de démarrer un workflow, telles qu'on veut les lire d'un coup d'œil. */
export type TriggerKind =
  'manual' | 'schedule' | 'webhook' | 'form' | 'chat' | 'sub-workflow' | 'error' | 'app';

/**
 * Ordre d'affichage : du plus « autonome » au plus subordonné. Le trigger manuel ferme
 * la marche — il ne dit pas comment le workflow tourne, seulement qu'on peut le lancer
 * à la main pour le tester.
 */
const TRIGGER_KIND_ORDER: TriggerKind[] = [
  'schedule',
  'webhook',
  'form',
  'chat',
  'app',
  'error',
  'sub-workflow',
  'manual',
];

/** Nature d'un nœud trigger : comment il met le workflow en route. */
export function triggerKindOf(node: { type: string }): TriggerKind {
  const type = node.type.toLowerCase();
  if (isManualTriggerNode(node)) return 'manual';
  if (isSubWorkflowTrigger(node)) return 'sub-workflow';
  if (type.includes('scheduletrigger') || type.includes('cron') || type.includes('interval')) {
    return 'schedule';
  }
  if (type.includes('formtrigger')) return 'form';
  if (type.includes('chattrigger')) return 'chat';
  if (type.includes('errortrigger')) return 'error';
  if (type.includes('webhook')) return 'webhook';
  // Tout le reste est un trigger d'application (Telegram, Gmail, Airtable…).
  return 'app';
}

/**
 * Comment ce workflow peut démarrer. Un trigger désactivé ne compte pas — il ne démarre
 * rien. Un workflow sans aucun trigger actif renvoie une liste vide : plus personne ne
 * peut le lancer, sauf en le rouvrant dans n8n.
 */
export function workflowTriggerKinds(workflow: N8nWorkflow): TriggerKind[] {
  const kinds = new Set(
    (workflow.nodes ?? []).filter((n) => !n.disabled && isTriggerNode(n)).map(triggerKindOf),
  );
  return TRIGGER_KIND_ORDER.filter((kind) => kinds.has(kind));
}

export function hasTrigger(workflow: N8nWorkflow): boolean {
  return workflow.nodes.some((n) => isTriggerNode(n));
}
