import { Injectable } from '@nestjs/common';
import {
  CallContextKind,
  EnvName,
  N8nWorkflow,
  TriggerKind,
  buildAutoWorkflowLinks,
  detectWorkflowEnv,
  extractUrlHost,
  isWorkflowArchived,
  workflowTriggerKinds,
  workflowEntryPoints,
  msg,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { TESTER_WORKFLOW_WHERE } from '../../infra/settings/tester-workflows.where';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { WorkflowLinksService } from './workflow-links.service';

export interface WorkflowMapNode {
  /** Id du workflow, ou `ext:<clé>` pour une cible appelée mais non synchronisée. */
  id: string;
  name: string;
  /** true = cible hors périmètre (workflow non synchronisé, ou d'une autre instance). */
  external: boolean;
  instanceId?: string;
  active?: boolean;
  archived?: boolean;
  /** Façons de démarrer ce workflow (triggers désactivés exclus). */
  triggers?: TriggerKind[];
  /**
   * Ce qui met ce workflow en route, vu de l'extérieur : URL publique quand il y en a une
   * (webhook, formulaire, chat), sinon un libellé (« planifié », « Telegram »…).
   */
  entryPoints?: { kind: TriggerKind; label: string; nodeName: string }[];
  env?: EnvName | null;
  externalId?: string;
}

export interface WorkflowMapLink {
  id: string;
  origin: 'auto' | 'manual';
  /** execute | tool | webhook pour l'auto, manual pour les liens saisis. */
  kind: string;
  fromId: string;
  toId: string;
  /** Libellé saisi (liens manuels). */
  label?: string;
  note?: string;
  /** Nœuds n8n à l'origine du lien (liens automatiques). */
  nodeNames?: string[];
  /**
   * D'où part l'appel quand ce n'est pas un flux ordinaire : `loop` (une fois par tour),
   * `manual` (bouton de test), `sub-workflow` (seulement si un parent tourne).
   * `nodeCount` = taille de ce bout de workflow.
   */
  context?: { kind: CallContextKind; nodeCount: number };
}

export interface WorkflowMapView {
  nodes: WorkflowMapNode[];
  links: WorkflowMapLink[];
}

/** Workflow tel que stocké, réduit à ce dont la carte a besoin. */
type StoredWorkflow = {
  id: string;
  name: string;
  tags: string[];
  instanceId: string;
  externalId: string;
  raw: unknown;
};

/** Archivé au sens n8n (`isArchived`) ou plateforme (préfixe `[ARCHIVED] ` / tag `archived`). */
function isArchived(workflow: StoredWorkflow): boolean {
  return (
    (workflow.raw as { isArchived?: boolean } | null)?.isArchived === true ||
    isWorkflowArchived(workflow.name, workflow.tags)
  );
}

/** Schéma workflow → workflow, calculé à la volée depuis les workflows synchronisés : pas de rebuild. */
@Injectable()
export class WorkflowMapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: WorkflowLinksService,
    private readonly settings: PlatformSettingsService,
  ) {}

  async map(instanceId?: string): Promise<WorkflowMapView> {
    // Exception au filtre global : les archivés restent chargés pour résoudre les
    // appels qui les visent (« appel mort à corriger »). Ils sont marqués `archived`
    // et masqués côté carte par le switch dédié, dont l'état initial suit le réglage.
    // Les workflows de travail du module tester, eux, n'entrent pas : le seul
    // appelant d'un bouchon est la copie `[TEST]`, elle-même hors carte.
    // Carte n8n seulement : tout ce qui suit lit un JSON n8n (nœuds, connexions, webhooks),
    // et un blueprint Make n'a ni `nodes` ni `connections` — il faisait échouer la page entière.
    // Une plateforme dont on ne sait pas lire les appels n'apparaît pas plutôt que d'y poser
    // des nœuds isolés, qui feraient croire à un scénario qui n'appelle personne.
    const workflows = await this.prisma.workflow.findMany({
      where: {
        ...(instanceId ? { instanceId } : {}),
        instance: { platform: 'n8n' },
        NOT: TESTER_WORKFLOW_WHERE,
      },
      orderBy: { name: 'asc' },
    });
    const envs = await this.settings.declaredEnvIds();
    const instances = await this.prisma.instance.findMany({
      select: { id: true, name: true, baseUrl: true },
    });
    const instanceNames = new Map(instances.map((i) => [i.id, i.name]));
    // Toutes les instances, pas seulement celle du filtre : un appel vers une autre
    // instance de la plateforme reste un appel « chez nous ».
    const knownHosts = instances.map((i) => extractUrlHost(i.baseUrl)).filter((h): h is string => !!h);
    const baseUrls = new Map(instances.map((i) => [i.id, i.baseUrl.replace(/\/+$/, '')]));
    const displayName = this.disambiguate(workflows, instanceNames);

    const nodes = new Map<string, WorkflowMapNode>();
    for (const workflow of workflows) {
      nodes.set(workflow.id, {
        id: workflow.id,
        name: displayName(workflow),
        external: false,
        instanceId: workflow.instanceId,
        externalId: workflow.externalId,
        active: workflow.active,
        archived: isArchived(workflow),
        triggers: workflowTriggerKinds(workflow.raw as unknown as N8nWorkflow),
        entryPoints: workflowEntryPoints(workflow.raw as unknown as N8nWorkflow).map((entry) => ({
          kind: entry.kind,
          nodeName: entry.nodeName,
          label: entry.segment
            ? `${baseUrls.get(workflow.instanceId) ?? ''}/${entry.segment}/${entry.path}`
            : (entry.label ?? entry.kind),
        })),
        env: detectWorkflowEnv(workflow.name, workflow.tags, envs),
      });
    }

    const links: WorkflowMapLink[] = [];

    const auto = buildAutoWorkflowLinks(
      workflows.map((w) => ({
        id: w.id,
        externalId: w.externalId,
        name: w.name,
        raw: w.raw as unknown as N8nWorkflow,
      })),
      knownHosts,
    );
    for (const link of auto) {
      let toId = link.toWorkflowId;
      if (!toId) {
        toId = `ext:${link.unresolvedKey}`;
        if (!nodes.has(toId)) {
          nodes.set(toId, { id: toId, name: link.unresolvedLabel ?? toId, external: true });
        }
      }
      links.push({
        id: `auto:${link.fromWorkflowId}>${toId}:${link.kind}`,
        origin: 'auto',
        kind: link.kind,
        fromId: link.fromWorkflowId,
        toId,
        nodeNames: link.nodeNames,
        context: link.context,
      });
    }

    for (const link of await this.links.list(instanceId)) {
      // Un lien manuel dont un bout est hors périmètre (autre instance) n'est pas affichable ici.
      if (!nodes.has(link.fromWorkflowId) || !nodes.has(link.toWorkflowId)) continue;
      links.push({
        id: link.id,
        origin: 'manual',
        kind: 'manual',
        fromId: link.fromWorkflowId,
        toId: link.toWorkflowId,
        label: link.label || undefined,
        note: link.note ?? undefined,
      });
    }

    return { nodes: [...nodes.values()], links };
  }

  /**
   * Les homonymes sont indiscernables sur un schéma : on ajoute le plus petit
   * complément qui départage — « archivé », sinon l'instance, sinon l'id n8n.
   */
  private disambiguate(
    workflows: StoredWorkflow[],
    instanceNames: Map<string, string>,
  ): (workflow: { id: string; name: string }) => string {
    // Insensible à la casse : l'œil confond « Normalize Phone » et « Normalize phone ».
    const homonyms = new Map<string, StoredWorkflow[]>();
    for (const workflow of workflows) {
      const key = workflow.name.trim().toLowerCase();
      homonyms.set(key, [...(homonyms.get(key) ?? []), workflow]);
    }

    const labels = new Map<string, string>();
    for (const group of homonyms.values()) {
      for (const workflow of group) {
        const others = group.filter((o) => o.id !== workflow.id);
        const parts: string[] = [];
        // « archivé » ne départage que si au moins un homonyme est vivant.
        let ambiguous = others;
        if (isArchived(workflow) && others.some((o) => !isArchived(o))) {
          parts.push(msg('platform.mapArchived'));
          ambiguous = others.filter((o) => isArchived(o));
        } else if (!isArchived(workflow)) {
          ambiguous = others.filter((o) => !isArchived(o));
        }
        if (ambiguous.some((o) => o.instanceId === workflow.instanceId)) {
          parts.push(`#${workflow.externalId}`);
        } else if (ambiguous.length > 0) {
          parts.push(instanceNames.get(workflow.instanceId) ?? msg('platform.mapUnknownInstance'));
        }
        labels.set(workflow.id, [workflow.name, ...parts].join(' · '));
      }
    }

    return (workflow) => labels.get(workflow.id) ?? workflow.name;
  }
}
