import { Injectable, Logger } from '@nestjs/common';
import {
  CalledUrl,
  N8nWorkflow,
  NocoDbHostHint,
  extractNodeResourceRefs,
  guessNocoDbHosts,
  isNocoDbCloud,
  paramString,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { DiscoveredLabel, ResourceLabelsService } from '../../infra/resource-labels/resource-labels.service';
import { DiscoverInput, ResourceDiscoveryService } from './resource-discovery.service';
import { normalizeHost } from './provider-catalog';

/** Un credential NocoDB tel que les workflows le montrent, avec son host éventuel. */
export interface NocoDbEndpoint {
  credentialType: string;
  credentialId: string;
  credentialName?: string;
  /** Bases distinctes atteintes avec ce credential. */
  projectIds: string[];
  nodeCount: number;
  host?: string;
  /** Instances repérées dans les appels HTTP, à proposer tant que le host n'est pas saisi. */
  hostCandidates: NocoDbHostHint[];
}

export interface NocoDbRefreshResult {
  /** Ressources dont le vrai nom est désormais connu. */
  resolved: number;
  /** Credentials laissés de côté faute de host renseigné. */
  missingHost: Array<{ credentialId: string; credentialName?: string }>;
  /** Bases dont la découverte a échoué (host faux, token périmé…). */
  failed: Array<{ credentialId: string; projectId?: string; reason: string }>;
}

/** Ce qu'un nœud NocoDB nous apprend : sa base, sa table, et par quel credential. */
interface NocoDbNodeRef {
  credentialType: string;
  credentialId: string;
  credentialName?: string;
  projectId: string;
  /** Absent quand la table est désignée par une expression. */
  tableId?: string;
  nodeName: string;
}

/**
 * Retrouve les vrais noms des bases et tables NocoDB. Le JSON n8n ne porte que des
 * ids (pas de resourceLocator, donc pas de `cachedResultName`) : on lit les titres
 * via la découverte — n8n seul détient le token — et on les cache dans `ResourceLabel`.
 */
@Injectable()
export class NocoDbLabelsService {
  private readonly logger = new Logger(NocoDbLabelsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
    private readonly labels: ResourceLabelsService,
    private readonly discovery: ResourceDiscoveryService,
  ) {}

  /** Credentials NocoDB rencontrés dans les workflows, avec le host connu ou deviné. */
  async endpoints(instanceId?: string): Promise<NocoDbEndpoint[]> {
    const workflows = await this.load(instanceId);
    const refs = scanRefs(workflows);
    const calledUrls = httpUrls(workflows);
    const hosts = await this.hosts();
    const byCredential = new Map<string, NocoDbEndpoint & { ids: string[] }>();

    for (const ref of refs) {
      let entry = byCredential.get(ref.credentialId);
      if (!entry) {
        entry = {
          credentialType: ref.credentialType,
          credentialId: ref.credentialId,
          credentialName: ref.credentialName,
          projectIds: [],
          nodeCount: 0,
          host: hosts.get(ref.credentialId),
          hostCandidates: [],
          ids: [],
        };
        byCredential.set(ref.credentialId, entry);
      }
      entry.nodeCount += 1;
      if (!entry.projectIds.includes(ref.projectId)) entry.projectIds.push(ref.projectId);
      for (const id of [ref.projectId, ref.tableId]) {
        if (id && !entry.ids.includes(id)) entry.ids.push(id);
      }
    }

    return [...byCredential.values()]
      .map(({ ids, ...entry }) => ({ ...entry, hostCandidates: guessNocoDbHosts(calledUrls, ids) }))
      .sort((a, b) => b.nodeCount - a.nodeCount);
  }

  async setHost(credentialId: string, host: string): Promise<NocoDbEndpoint | undefined> {
    const normalized = normalizeHost(host);
    await this.prisma.providerEndpoint.upsert({
      where: { provider_credentialId: { provider: 'nocodb', credentialId } },
      create: { provider: 'nocodb', credentialId, host: normalized },
      update: { host: normalized },
    });
    return (await this.endpoints()).find((entry) => entry.credentialId === credentialId);
  }

  /** Redécouvre les noms : une découverte par credential (bases) puis par base (tables) — rien au-delà de ce que les workflows référencent. */
  async refresh(instanceId: string): Promise<NocoDbRefreshResult> {
    const refs = scanRefs(await this.load(instanceId));
    const hosts = await this.hosts();
    const result: NocoDbRefreshResult = { resolved: 0, missingHost: [], failed: [] };
    const labels: DiscoveredLabel[] = [];

    for (const [credentialId, group] of groupBy(refs, (ref) => ref.credentialId)) {
      const host = hosts.get(credentialId);
      const credentialName = group[0].credentialName;
      if (!host) {
        result.missingHost.push({ credentialId, credentialName });
        continue;
      }
      const common = {
        instanceId,
        provider: 'nocodb',
        credentialType: group[0].credentialType,
        credentialId,
        credentialName,
        host,
      };

      // Les titres de bases servent à préfixer les tables : « Services — Contacts ».
      const baseNames = new Map<string, string>();
      try {
        // Cloud : un listing par workspace. Auto-hébergé : un seul, à la racine.
        for (const workspaceId of await this.workspaceIds(common)) {
          const { items } = await this.discovery.discover({
            ...common,
            stepId: 'bases',
            parentId: workspaceId,
          });
          for (const item of items) baseNames.set(item.id, item.name);
        }
      } catch (error) {
        result.failed.push({ credentialId, reason: (error as Error).message });
        this.logger.warn(`Unreadable NocoDB bases (${credentialId}): ${(error as Error).message}`);
        continue;
      }

      for (const projectId of unique(group.map((ref) => ref.projectId))) {
        const baseName = baseNames.get(projectId);
        if (baseName) labels.push({ key: `nocodb:${projectId}`, provider: 'nocodb', label: baseName });
        try {
          const { items } = await this.discovery.discover({
            ...common,
            stepId: 'tables',
            parentId: projectId,
          });
          for (const table of items) {
            if (!table.id || !table.name) continue;
            labels.push({
              key: `nocodb:${projectId}/${table.id}`,
              provider: 'nocodb',
              label: baseName ? `${baseName} — ${table.name}` : table.name,
            });
          }
        } catch (error) {
          result.failed.push({ credentialId, projectId, reason: (error as Error).message });
          this.logger.warn(`Unreadable NocoDB tables (${projectId}): ${(error as Error).message}`);
        }
      }
    }

    result.resolved = await this.labels.upsertMany(labels);
    return result;
  }

  /**
   * Workspaces sous lesquels chercher les bases : la notion n'existe pas en
   * auto-hébergé (un seul `undefined`, bases à la racine), le cloud impose un
   * listing préalable.
   */
  private async workspaceIds(
    common: Omit<DiscoverInput, 'stepId' | 'parentId'>,
  ): Promise<Array<string | undefined>> {
    if (!isNocoDbCloud(common.host ?? '')) return [undefined];
    const { items } = await this.discovery.discover({ ...common, stepId: 'workspaces' });
    return items.map((item) => item.id).filter((id) => id.length > 0);
  }

  private async hosts(): Promise<Map<string, string>> {
    const rows = await this.prisma.providerEndpoint.findMany({ where: { provider: 'nocodb' } });
    return new Map(rows.map((row) => [row.credentialId, row.host]));
  }

  private async load(instanceId?: string): Promise<Array<{ name: string; raw: N8nWorkflow }>> {
    const rows = await this.prisma.workflow.findMany({
      where: {
        ...(instanceId ? { instanceId } : {}),
        ...(await this.settings.workflowFilter()),
      },
      select: { name: true, raw: true },
    });
    return rows.map((row) => ({ name: row.name, raw: row.raw as unknown as N8nWorkflow }));
  }
}

/** Tous les nœuds NocoDB des workflows snapshotés, réduits à ce qui nous intéresse. */
function scanRefs(workflows: Array<{ raw: N8nWorkflow }>): NocoDbNodeRef[] {
  const refs: NocoDbNodeRef[] = [];
  for (const workflow of workflows) {
    for (const node of workflow.raw.nodes ?? []) {
      if (!node.type.toLowerCase().includes('nocodb')) continue;
      const parameters = node.parameters ?? {};
      const projectId = paramString(parameters['projectId']);
      // Une base désignée par une expression n'a pas d'id stable à résoudre.
      if (!projectId || projectId.includes('{{')) continue;
      const tableId = paramString(parameters['table']);
      const [credentialType, credential] =
        Object.entries(node.credentials ?? {}).find(([type]) => type.toLowerCase().includes('nocodb')) ?? [];
      if (!credentialType || !credential?.id) continue;
      refs.push({
        credentialType,
        credentialId: credential.id,
        credentialName: credential.name,
        projectId,
        tableId: tableId && !tableId.includes('{{') ? tableId : undefined,
        nodeName: node.name,
      });
    }
  }
  return refs;
}

/** URLs appelées par les nœuds HTTP : c'est là que l'instance NocoDB se trahit. */
function httpUrls(workflows: Array<{ name: string; raw: N8nWorkflow }>): CalledUrl[] {
  const urls: CalledUrl[] = [];
  for (const workflow of workflows) {
    for (const node of workflow.raw.nodes ?? []) {
      for (const ref of extractNodeResourceRefs(node)) {
        if (ref.provider !== 'http' || !ref.detail?.['url']) continue;
        urls.push({ url: ref.detail['url'], workflowName: workflow.name, nodeName: node.name });
      }
    }
  }
  return urls;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const bucket = groups.get(key(item));
    if (bucket) bucket.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
