import { N8nWorkflow, detectPublishModel } from '@nwm/core';

/** Nœud tel que présenté à l'IA (les paramètres peuvent être élagués si le workflow est énorme). */
interface ContextNode {
  name: string;
  type: string;
  typeVersion?: number;
  disabled?: boolean;
  notes?: string;
  credentials?: string[];
  parameters?: Record<string, unknown>;
  /** Présent quand les paramètres ont été retirés faute de place. */
  parametersOmitted?: string;
}

export interface WorkflowChatContext {
  workflow: {
    name: string;
    active: boolean;
    tags: string[];
    nodeCount: number;
    /**
     * État de publication sur les n8n qui séparent brouillon et version publiée.
     * `null` sur une instance qui ne les sépare pas. Sans cette ligne, l'assistant
     * déclarait ne pas voir « le système de versioning de n8n » — et renvoyait
     * l'utilisateur vers un problème de licence, alors que la plateforme sait
     * exactement où en est le workflow et sait le publier.
     */
    published: boolean | null;
  };
  nodes: ContextNode[];
  connections: unknown;
  findings: Array<{ severity: string; module: string; code: string; nodeName?: string; message: string }>;
  /** Nœuds dont les paramètres ont été élagués (l'IA doit demander avant de les modifier). */
  truncatedNodes: string[];
  /**
   * Les sous-workflows appelés — leur CONTENU n'est pas ici : il se demande à
   * `read_workflow`, et une conversation qui n'en parle pas ne le paie pas.
   */
  subWorkflows?: ContextSubWorkflow[];
}

/** `null` quand l'instance ignore la publication par versions : rien à en dire. */
function publishedState(raw: N8nWorkflow): boolean | null {
  const model = detectPublishModel(raw);
  return model === 'direct' ? null : model === 'versioned-published';
}

/** Budget de sérialisation du contexte (caractères) : garde-fou contre les workflows géants. */
const MAX_CONTEXT_CHARS = 120_000;

export interface ChatContextOptions {
  /**
   * Nœuds au cœur de la demande (nœud d'un finding, nœud fautif d'une erreur).
   * Leurs paramètres sont les derniers élagués : sans eux la réponse est
   * forcément « donne-moi le contenu du nœud », soit un aller-retour de plus.
   */
  focusNodes?: string[];
  /**
   * Budget de sérialisation, quand ce n'est pas le workflow de la conversation.
   * Un sous-workflow lu en cours de tour partage le contexte avec lui : servi au
   * budget plein, un gros appelé chasserait celui sur lequel on travaille.
   */
  budget?: number;
  /**
   * Les sous-workflows appelés, et comment on y arrive. Le nœud « Execute
   * Workflow » ne porte qu'un id : sans cette liste, l'assistant ne pouvait ni
   * nommer ce qu'il déclenche, ni savoir qu'il a le droit d'aller le lire.
   */
  subWorkflows?: ContextSubWorkflow[];
}

/** Un sous-workflow du périmètre, annoncé dans le contexte du tour. */
export interface ContextSubWorkflow {
  name: string;
  externalId: string;
  /** Les nœuds qui l'appellent, sous la forme `« Appelant » → nœud`. */
  calledBy: string[];
  /** Modifiable, ou lisible seulement (archivé, disparu de n8n). */
  editable: boolean;
  reason?: string;
}

export interface FindingSummary {
  severity: string;
  module: string;
  code: string;
  nodeName: string | null;
  message: string;
}

function sizeOf(node: ContextNode): number {
  return JSON.stringify(node.parameters ?? {}).length;
}

/**
 * Construit le contexte envoyé au modèle : le workflow lisible (nœuds + connexions)
 * et les findings connus. Si le tout dépasse le budget, les paramètres des plus gros
 * nœuds sont retirés en premier — jamais leur nom ni leur type.
 */
export function buildChatContext(
  raw: N8nWorkflow,
  workflowMeta: { name: string; active: boolean; tags: string[] },
  findings: FindingSummary[],
  options: ChatContextOptions = {},
): WorkflowChatContext {
  const focus = new Set(options.focusNodes ?? []);
  const nodes: ContextNode[] = (raw.nodes ?? []).map((node) => ({
    name: node.name,
    type: node.type,
    ...(node.typeVersion !== undefined ? { typeVersion: node.typeVersion } : {}),
    ...(node.disabled ? { disabled: true } : {}),
    ...(node.notes ? { notes: node.notes } : {}),
    ...(node.credentials
      ? { credentials: Object.values(node.credentials).map((c) => c.name ?? c.id ?? '?') }
      : {}),
    parameters: node.parameters ?? {},
  }));

  const truncatedNodes: string[] = [];
  const budget = options.budget ?? MAX_CONTEXT_CHARS;
  const baseSize = JSON.stringify(raw.connections ?? {}).length + JSON.stringify(findings).length;
  let total = baseSize + nodes.reduce((sum, node) => sum + sizeOf(node) + node.name.length + 80, 0);

  while (total > budget) {
    const candidates = nodes.filter((node) => node.parameters !== undefined);
    // Hors focus d'abord : on préfère un contexte incomplet ailleurs qu'un nœud
    // à corriger dont l'IA ne voit pas le contenu.
    const pool = candidates.filter((node) => !focus.has(node.name));
    const biggest = (pool.length > 0 ? pool : candidates).sort((a, b) => sizeOf(b) - sizeOf(a))[0];
    if (!biggest) break;
    total -= sizeOf(biggest);
    delete biggest.parameters;
    biggest.parametersOmitted = 'paramètres non fournis (workflow trop volumineux)';
    truncatedNodes.push(biggest.name);
  }

  return {
    workflow: {
      name: workflowMeta.name,
      active: workflowMeta.active,
      tags: workflowMeta.tags,
      nodeCount: nodes.length,
      published: publishedState(raw),
    },
    nodes,
    connections: raw.connections ?? {},
    findings: findings.map((finding) => ({
      severity: finding.severity,
      module: finding.module,
      code: finding.code,
      ...(finding.nodeName ? { nodeName: finding.nodeName } : {}),
      message: finding.message,
    })),
    truncatedNodes,
    ...(options.subWorkflows?.length ? { subWorkflows: options.subWorkflows } : {}),
  };
}
