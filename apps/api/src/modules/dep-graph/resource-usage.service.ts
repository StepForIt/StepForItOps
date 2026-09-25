import { Injectable } from '@nestjs/common';
import {
  ColumnImpact,
  N8nNode,
  N8nWorkflow,
  ResourceFieldUsage,
  ResourceRef,
  columnImpact,
  detectWorkflowEnv,
  envIds,
  extractNodeResourceRefs,
  extractResourceFieldUsages,
  isMonitoredEnv,
  matchesResourceQuery,
  paramString,
  requiredNotMapped,
  resourceSearchTerms,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { ResourceLabelsService } from '../../infra/resource-labels/resource-labels.service';
import { PROVIDER_LABELS, friendlyLabel } from './resource-label';

/** Une table se raisonne colonne par colonne ; une API n'a pas de colonnes, on regarde ses routes. */
export type ResourceKind = 'table' | 'api';

/** Une ressource externe, telle qu'elle apparaît dans le sélecteur. */
export interface ResourceSummary {
  key: string;
  label: string;
  provider: string;
  kind: ResourceKind;
  /** Clé du contenant (base, document, projet), pour grouper le sélecteur. */
  containerKey: string;
  containerLabel: string;
  itemLabel?: string;
  workflowCount: number;
  nodeCount: number;
  /** La ressource est désignée par une expression : elle ne vaut que pour ce nœud. */
  dynamic: boolean;
  /** Nom posé à la main : il prime, et c'est le seul rattachement possible d'une API à son système. */
  aliased: boolean;
  /** Tout ce sous quoi elle peut être cherchée (cf. `resource-search` du domaine). */
  terms: string[];
}

/** Ce qu'un nœud fait de la ressource, replacé dans son workflow. */
export interface ResourceNodeUsage extends ResourceFieldUsage {
  workflowId: string;
  workflowName: string;
  instanceId: string;
  /** Colonnes que n8n donnait pour obligatoires et que le nœud n'écrit pas. */
  requiredNotMapped: string[];
  /** Renseigné seulement quand une colonne est passée en paramètre. */
  impact?: ColumnImpact;
  impactReason?: string;
}

/** Un nœud qui touche la ressource, sans analyse de champs — le socle commun à tous les types. */
export interface ResourceCall {
  workflowId: string;
  workflowName: string;
  instanceId: string;
  nodeName: string;
  nodeType: string;
  disabled: boolean;
  /** APIs externes : la route appelée et la méthode, ce que l'hôte seul ne dit pas. */
  url?: string;
  method?: string;
}

export interface ResourceUsageResult {
  resource: { key: string; label: string; provider: string; kind: ResourceKind } | null;
  column?: string;
  /** Union des colonnes que les nœuds connaissent — sert à proposer des noms. */
  knownColumns: string[];
  /** Analyse champ par champ : vide pour une ressource sans colonnes. */
  usages: ResourceNodeUsage[];
  /** Tous les nœuds qui la touchent, quel que soit son type. */
  calls: ResourceCall[];
}

interface LoadedWorkflow {
  id: string;
  name: string;
  instanceId: string;
  raw: N8nWorkflow;
}

function kindOf(provider: string): ResourceKind {
  return provider === 'http' ? 'api' : 'table';
}

/** `airtable:appXXX/tblYYY` → `airtable:appXXX` : la base, sans la table. */
function containerKeyOf(key: string): string {
  const slash = key.indexOf('/');
  return slash === -1 ? key : key.slice(0, slash);
}

/**
 * « Qui utilise cette ressource, et qu'est-ce que ça change si je la modifie ? »
 * Tout est relu à la volée depuis les workflows synchronisés : rien à reconstruire,
 * réponse jamais périmée.
 */
@Injectable()
export class ResourceUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
    private readonly discoveredLabels: ResourceLabelsService,
  ) {}

  /**
   * Les workflows à interroger. Par défaut les seuls envs surveillés
   * (`isMonitoredEnv`, env indéterminé compris) : « qui utilise cette table » compte des workflows,
   * et les exemplaires dev et preprod du même workflow métier faisaient compter
   * deux ou trois fois le même usage — un « 6 workflows » qui n'en fait que
   * deux. Le filtre est ici et non dans l'UI, sinon les compteurs mentiraient.
   */
  private async load(instanceId?: string, includeOtherEnvs = false): Promise<LoadedWorkflow[]> {
    const rows = await this.prisma.workflow.findMany({
      where: { ...(instanceId ? { instanceId } : {}), ...(await this.settings.workflowFilter()) },
      select: { id: true, name: true, instanceId: true, tags: true, raw: true },
      orderBy: { name: 'asc' },
    });
    const envs = await this.settings.declaredEnvs();
    const ids = envIds(envs);
    return rows
      .filter((row) => includeOtherEnvs || isMonitoredEnv(detectWorkflowEnv(row.name, row.tags, ids), envs))
      .map(({ tags, ...row }) => ({ ...row, raw: row.raw as unknown as N8nWorkflow }));
  }

  /** Noms posés à la main : prioritaires sur tout le reste. */
  private async aliases(): Promise<Map<string, string>> {
    const rows = await this.prisma.depNodeAlias.findMany();
    return new Map(rows.map((row) => [row.key, row.label]));
  }

  /** Ressources pour le sélecteur. Les refs `execute-workflow` sont écartées : c'est le métier de la carte des workflows. */
  async resources(filters: {
    instanceId?: string;
    q?: string;
    includeOtherEnvs?: boolean;
  }): Promise<ResourceSummary[]> {
    const [workflows, aliases, discovered] = await Promise.all([
      this.load(filters.instanceId, filters.includeOtherEnvs),
      this.aliases(),
      this.discoveredLabels.all(),
    ]);
    const byKey = new Map<string, ResourceSummary & { workflows: Set<string>; urls: Set<string> }>();

    for (const workflow of workflows) {
      for (const node of workflow.raw.nodes ?? []) {
        for (const ref of extractNodeResourceRefs(node)) {
          if (ref.provider === 'execute-workflow') continue;
          const entry = byKey.get(ref.key) ?? this.newSummary(ref, aliases, discovered);
          entry.nodeCount += 1;
          entry.workflows.add(workflow.id);
          entry.workflowCount = entry.workflows.size;
          if (ref.detail?.['url']) entry.urls.add(ref.detail['url']);
          // Le premier passage peut n'avoir que les ids ; un nœud suivant peut
          // porter le nom lisible mis en cache par n8n.
          if (!aliases.has(ref.key) && (ref.label || discovered.has(ref.key))) {
            this.applyNames(entry, ref, discovered.get(ref.key));
          }
          byKey.set(ref.key, entry);
        }
      }
    }

    const query = filters.q?.trim();
    return [...byKey.values()]
      .map(({ workflows, urls, ...summary }) => ({
        ...summary,
        terms: resourceSearchTerms({
          key: summary.key,
          provider: summary.provider,
          providerLabel: PROVIDER_LABELS[summary.provider],
          containerName: summary.containerLabel,
          itemName: summary.itemLabel,
          alias: summary.aliased ? summary.label : undefined,
          urls: [...urls].slice(0, 50),
        }),
      }))
      .filter((resource) => !query || matchesResourceQuery(resource.terms, query))
      .sort((a, b) => b.nodeCount - a.nodeCount || a.label.localeCompare(b.label));
  }

  private newSummary(
    ref: ResourceRef,
    aliases: Map<string, string>,
    discovered: Map<string, string>,
  ): ResourceSummary & { workflows: Set<string>; urls: Set<string> } {
    const summary = {
      key: ref.key,
      label: aliases.get(ref.key) ?? friendlyLabel(ref, discovered.get(ref.key)),
      provider: ref.provider,
      kind: kindOf(ref.provider),
      containerKey: containerKeyOf(ref.key),
      containerLabel: '',
      itemLabel: undefined as string | undefined,
      workflowCount: 0,
      nodeCount: 0,
      dynamic: ref.key.includes('{{'),
      aliased: aliases.has(ref.key),
      terms: [] as string[],
      workflows: new Set<string>(),
      urls: new Set<string>(),
    };
    this.applyNames(summary, ref, discovered.get(ref.key));
    return summary;
  }

  /** Sans vrai nom connu (NocoDB avant découverte), le contenant retombe sur la clé technique : un id reste cherchable. */
  private applyNames(summary: ResourceSummary, ref: ResourceRef, discovered?: string): void {
    if (!summary.aliased) summary.label = friendlyLabel(ref, discovered);
    const container = ref.names?.container;
    const item = ref.names?.item ?? discovered;
    summary.containerLabel = container ?? containerKeyOf(ref.key).split(':').slice(1).join(':');
    summary.itemLabel = item;
  }

  /** Détail d'une ressource : les nœuds qui la touchent, et ce qu'un changement leur impose. */
  async usage(params: {
    key: string;
    column?: string;
    instanceId?: string;
    includeOtherEnvs?: boolean;
  }): Promise<ResourceUsageResult> {
    const [workflows, aliases, discovered] = await Promise.all([
      this.load(params.instanceId, params.includeOtherEnvs),
      this.aliases(),
      this.discoveredLabels.all(),
    ]);
    const column = params.column?.trim();

    const usages: ResourceNodeUsage[] = [];
    const calls: ResourceCall[] = [];
    const knownColumns = new Set<string>();
    let label: string | undefined;
    let provider = params.key.slice(0, Math.max(params.key.indexOf(':'), 0));

    for (const workflow of workflows) {
      for (const usage of extractResourceFieldUsages(workflow.raw)) {
        if (usage.resourceKey !== params.key) continue;
        for (const known of usage.knownColumns ?? []) knownColumns.add(known.name);
        const verdict = column ? columnImpact(usage, column) : undefined;
        usages.push({
          ...usage,
          workflowId: workflow.id,
          workflowName: workflow.name,
          instanceId: workflow.instanceId,
          requiredNotMapped: requiredNotMapped(usage),
          impact: verdict?.impact,
          impactReason: verdict?.reason,
        });
      }
      // Le label lisible vit sur la référence, pas sur l'usage — et c'est aussi
      // d'ici que sort la liste des nœuds pour les ressources sans colonnes.
      for (const node of workflow.raw.nodes ?? []) {
        for (const ref of extractNodeResourceRefs(node)) {
          if (ref.key !== params.key) continue;
          provider = ref.provider;
          const named = discovered.get(ref.key);
          label ??= friendlyLabel(ref, named);
          if (ref.label || named) label = friendlyLabel(ref, named);
          calls.push({
            workflowId: workflow.id,
            workflowName: workflow.name,
            instanceId: workflow.instanceId,
            nodeName: node.name,
            nodeType: node.type,
            disabled: node.disabled === true,
            url: ref.detail?.['url'],
            method: methodOf(node),
          });
        }
      }
    }

    if (calls.length === 0 && usages.length === 0 && !label)
      return { resource: null, column, knownColumns: [], usages: [], calls: [] };

    return {
      resource: {
        key: params.key,
        label: aliases.get(params.key) ?? label ?? params.key,
        provider,
        kind: kindOf(provider),
      },
      column,
      knownColumns: [...knownColumns].sort((a, b) => a.localeCompare(b)),
      usages,
      calls,
    };
  }
}

/** Méthode HTTP déclarée par le nœud ; n8n omet le paramètre quand c'est un GET. */
function methodOf(node: N8nNode): string | undefined {
  if (!node.type.toLowerCase().includes('httprequest')) return undefined;
  return paramString(node.parameters?.['method']) ?? 'GET';
}
