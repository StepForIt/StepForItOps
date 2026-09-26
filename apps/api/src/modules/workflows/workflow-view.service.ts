import { Injectable } from '@nestjs/common';
import {
  GraphEdge,
  MermaidFlag,
  N8nNode,
  N8nWorkflow,
  WorkflowGraph,
  isStickyNote,
  workflowToMermaid,
  MakeBlueprint,
  WorkflowActions,
  MakeFlag,
  flattenModules,
  makeMermaid,
  makeModuleEdges,
  makeScenarioUrl,
  moduleLabel,
  msg,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { WorkflowsService, WorkflowWithEnv } from './workflows.service';

/** Nœud atteint depuis celui-ci ; `branch` n'est posé que si ce n'est pas la sortie principale. */
export interface NextLink {
  node: string;
  branch?: string;
}

export interface ViewNode {
  name: string;
  type: string;
  typeVersion?: number;
  disabled: boolean;
  notes?: string;
  sticky: boolean;
  credentials: string[];
  /** Rang dans l'ordre d'exécution (1 = premier nœud atteint). */
  order: number;
  /** Point d'entrée du flux : rien en amont, et pas un sous-nœud branché (modèle IA, outil…). */
  entry: boolean;
  /** Nombre de connexions entrantes / sortantes (repère de lecture). */
  incoming: number;
  outgoing: number;
  /** Nœuds déclenchés juste après celui-ci, dans l'ordre des sorties. */
  next: NextLink[];
  parameters: Record<string, unknown>;
}

/** Finding déjà en base, tel qu'affiché à côté du schéma (aucune analyse relancée). */
export interface ViewFinding {
  id: string;
  module: string;
  severity: string;
  code: string;
  message: string;
  nodeName: string | null;
  suggestion: string | null;
  line: number | null;
  snippet: string | null;
  snippetStart: number | null;
}

/** Tout ce qu'il faut pour afficher un workflow sans passer par un module désactivable. */
export interface WorkflowView {
  id: string;
  name: string;
  /** Qui sert ce workflow : le libellé du lien et les onglets en dépendent. */
  platform: 'n8n' | 'make';
  /** Ce que l'écran a le droit de proposer, calculé par l'API. */
  actions: WorkflowActions;
  active: boolean;
  archived: boolean;
  /** Publié, sur les n8n qui séparent brouillon et version publiée ; `null` sinon. */
  published: boolean | null;
  tags: string[];
  n8nUrl: string;
  hash: string;
  updatedAt: Date;
  mermaid: string;
  nodes: ViewNode[];
  findings: ViewFinding[];
  stats: { nodes: number; stickies: number; disabled: number; connections: number; orphans: string[] };
}

function credentialNames(node: N8nNode): string[] {
  return Object.values(node.credentials ?? {}).map((credential) => credential.name ?? credential.id ?? '?');
}

/** Sorties d'un nœud, dans l'ordre de lecture : `main` d'abord, puis par index de sortie. */
function outgoingEdges(graph: WorkflowGraph, from: string): GraphEdge[] {
  return graph.edges
    .filter((edge) => edge.from === from)
    .sort(
      (a, b) =>
        Number(a.outputType !== 'main') - Number(b.outputType !== 'main') ||
        a.outputIndex - b.outputIndex ||
        a.to.localeCompare(b.to),
    );
}

function byPosition(a: N8nNode, b: N8nNode): number {
  return (a.position?.[0] ?? 0) - (b.position?.[0] ?? 0) || (a.position?.[1] ?? 0) - (b.position?.[1] ?? 0);
}

/**
 * Ordre d'apparition : on part des nœuds sans entrée (déclencheurs, les plus à gauche
 * d'abord) et on suit les connexions en profondeur, branche par branche. Les nœuds
 * jamais atteints (cycles, îlots) puis les sticky notes ferment la liste.
 */
function executionOrder(raw: N8nWorkflow, graph: WorkflowGraph): string[] {
  const nodes = raw.nodes ?? [];
  const hasIncoming = new Set(graph.edges.map((edge) => edge.to));
  const flow = nodes.filter((node) => !isStickyNote(node));
  const order: string[] = [];
  const seen = new Set<string>();

  const walk = (name: string): void => {
    if (seen.has(name) || !graph.nodeNames.has(name)) return; // cible cassée : ignorée ici
    seen.add(name);
    order.push(name);
    for (const edge of outgoingEdges(graph, name)) walk(edge.to);
  };

  const roots = flow.filter((node) => !hasIncoming.has(node.name)).sort(byPosition);
  for (const root of roots) walk(root.name);
  for (const node of [...flow].sort(byPosition)) walk(node.name);
  for (const node of nodes.filter(isStickyNote).sort(byPosition)) {
    if (!seen.has(node.name)) order.push(node.name);
  }
  return order;
}

/** Les plus graves d'abord ; l'ordre alphabétique des sévérités ne dit rien. */
function severityRank(severity: string): number {
  return severity === 'error' ? 0 : severity === 'warning' ? 1 : 2;
}

/** Nœuds à entourer dans le schéma : la sévérité la plus haute l'emporte. */
function flaggedNodes(findings: ViewFinding[]): Map<string, MermaidFlag> {
  const flagged = new Map<string, MermaidFlag>();
  for (const finding of findings) {
    if (!finding.nodeName) continue;
    if (finding.severity === 'error') flagged.set(finding.nodeName, 'error');
    else if (finding.severity === 'warning' && flagged.get(finding.nodeName) !== 'error') {
      flagged.set(finding.nodeName, 'warning');
    }
  }
  return flagged;
}

/** Vue « lecture » d'un workflow : graphe Mermaid + inventaire des nœuds. */
@Injectable()
export class WorkflowViewService {
  constructor(
    private readonly workflows: WorkflowsService,
    private readonly prisma: PrismaService,
  ) {}

  async get(workflowId: string): Promise<WorkflowView> {
    const [{ workflow, raw }, rows] = await Promise.all([
      this.workflows.getRawAny(workflowId),
      this.prisma.finding.findMany({
        where: { workflowId },
        orderBy: [{ module: 'asc' }, { createdAt: 'desc' }],
      }),
    ]);
    const findings: ViewFinding[] = rows
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
      .map((row) => ({
        id: row.id,
        module: row.module,
        severity: row.severity,
        code: row.code,
        message: row.message,
        nodeName: row.nodeName ?? null,
        // `data` est libre par règle : la vue n'en expose que ce qu'elle affiche.
        suggestion: data(row)?.suggestion ?? null,
        line: data(row)?.line ?? null,
        snippet: data(row)?.snippet ?? null,
        snippetStart: data(row)?.snippetStart ?? null,
      }));
    if (workflow.platform === 'make') return this.makeView(workflow, raw as MakeBlueprint, findings);

    // Passé ce point, `raw` est du n8n : la plateforme l'a dit, pas une devinette.
    const n8n = raw as N8nWorkflow;
    const graph = new WorkflowGraph(n8n);

    const byName = new Map((n8n.nodes ?? []).map((node) => [node.name, node]));
    const nodes: ViewNode[] = executionOrder(n8n, graph).flatMap((name, index) => {
      const node = byName.get(name);
      if (!node) return [];
      const outgoing = outgoingEdges(graph, name);
      const incoming = graph.edges.filter((edge) => edge.to === name).length;
      return [
        {
          name: node.name,
          type: node.type,
          ...(node.typeVersion !== undefined ? { typeVersion: node.typeVersion } : {}),
          disabled: node.disabled === true,
          ...(node.notes ? { notes: node.notes } : {}),
          sticky: isStickyNote(node),
          credentials: credentialNames(node),
          order: index + 1,
          entry:
            incoming === 0 && !isStickyNote(node) && outgoing.every((edge) => edge.outputType === 'main'),
          incoming,
          outgoing: outgoing.length,
          next: outgoing.map((edge) => ({
            node: edge.to,
            ...(edge.outputType !== 'main'
              ? { branch: edge.outputType }
              : edge.outputIndex > 0
                ? { branch: msg('platform.viewOutputBranch', { index: edge.outputIndex }) }
                : {}),
          })),
          parameters: node.parameters ?? {},
        },
      ];
    });

    return {
      id: workflow.id,
      name: workflow.name,
      active: workflow.active,
      archived: workflow.archived,
      published: workflow.published,
      tags: workflow.tags,
      platform: 'n8n',
      actions: workflow.actions,
      n8nUrl: workflow.n8nUrl,
      hash: workflow.hash,
      updatedAt: workflow.updatedAt,
      mermaid: workflowToMermaid(n8n, { flagged: flaggedNodes(findings) }),
      nodes,
      findings,
      stats: {
        nodes: nodes.filter((node) => !node.sticky).length,
        stickies: nodes.filter((node) => node.sticky).length,
        disabled: nodes.filter((node) => node.disabled).length,
        connections: graph.edges.length,
        orphans: graph.orphanNodes(),
      },
    };
  }

  /**
   * La vue d'un scénario Make.
   *
   * Même objet de sortie que pour n8n — la page est la même, et la doubler pour
   * une plateforme de plus l'aurait fait diverger dès le premier changement.
   * Ce qui n'existe pas chez Make est rendu à zéro plutôt qu'omis : pas de
   * sticky notes, pas de modules désactivés, pas d'orphelins (l'imbrication ne
   * permet pas qu'un module traîne hors du flow).
   */
  private makeView(
    workflow: WorkflowWithEnv,
    blueprint: MakeBlueprint,
    findings: ViewFinding[],
  ): WorkflowView {
    const modules = flattenModules(blueprint);
    const edges = makeModuleEdges(blueprint);
    const labelById = new Map(modules.map((flat) => [flat.module.id, moduleLabel(flat.module)]));

    // Les findings portent le LIBELLÉ du module, pas son id : on rebrousse
    // chemin pour savoir lequel entourer dans le schéma.
    const flagged = new Map<number, MakeFlag>();
    for (const finding of findings) {
      if (!finding.nodeName) continue;
      for (const [id, label] of labelById) {
        if (label !== finding.nodeName) continue;
        if (finding.severity === 'error') flagged.set(id, 'error');
        else if (finding.severity === 'warning' && flagged.get(id) !== 'error') flagged.set(id, 'warning');
      }
    }

    const nodes: ViewNode[] = modules.map((flat, index) => {
      const outgoing = edges.filter((edge) => edge.fromId === flat.module.id);
      const incoming = edges.filter((edge) => edge.toId === flat.module.id).length;
      return {
        name: labelById.get(flat.module.id) ?? `#${flat.module.id}`,
        type: flat.module.module ?? msg('platform.unknownType'),
        ...(flat.module.version !== undefined ? { typeVersion: flat.module.version } : {}),
        disabled: false,
        sticky: false,
        credentials: [],
        order: index + 1,
        entry: incoming === 0,
        incoming,
        outgoing: outgoing.length,
        next: outgoing.map((edge) => ({
          node: labelById.get(edge.toId) ?? `#${edge.toId}`,
          ...(edge.label ? { branch: edge.label } : {}),
        })),
        parameters: { ...(flat.module.parameters ?? {}), ...(flat.module.mapper ?? {}) },
      };
    });

    return {
      id: workflow.id,
      name: workflow.name,
      active: workflow.active,
      archived: workflow.archived,
      published: null,
      tags: workflow.tags,
      platform: 'make',
      actions: workflow.actions,
      n8nUrl: makeScenarioUrl(workflow.zone, workflow.externalTeamId, workflow.externalId),
      hash: workflow.hash,
      updatedAt: workflow.updatedAt,
      mermaid: makeMermaid(blueprint, flagged),
      nodes,
      findings,
      stats: {
        nodes: nodes.length,
        stickies: 0,
        disabled: 0,
        connections: edges.length,
        orphans: [],
      },
    };
  }
}

/** Détail d'une règle : correctif proposé et position dans le code du nœud. */
function data(row: { data: unknown }) {
  return row.data as {
    suggestion?: string;
    line?: number;
    snippet?: string;
    snippetStart?: number;
  } | null;
}
