import { Injectable, NotFoundException } from '@nestjs/common';
import { N8nWorkflow, ResourceRef, extractResourceRefs } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { slug } from './provider-catalog';

/** Mapping existant qui contient déjà un id trouvé dans le workflow. */
export interface MappingHit {
  mappingId: string;
  logicalName: string;
  env: string;
  key: string;
}

export interface ScannedId {
  id: string;
  suggestedKey: string;
  mapping?: MappingHit;
}

/** Ressource externe regroupée (une base Airtable et ses tables, un doc Sheets…). */
export interface ScannedResource {
  provider: string;
  groupKey: string;
  label?: string;
  nodeNames: string[];
  /** Workflows membres qui la référencent (utile en scan de groupe). */
  workflows: string[];
  ids: ScannedId[];
}

export interface ScannedCredential {
  type: string;
  id: string;
  name?: string;
  nodeNames: string[];
  workflows: string[];
  mapping?: MappingHit;
}

export interface WorkflowScanResult {
  workflowId: string;
  workflowName: string;
  /** Env dominant déduit des ids déjà présents dans les mappings (null si aucun id connu). */
  detectedEnv: string | null;
  resources: ScannedResource[];
  credentials: ScannedCredential[];
}

export interface GroupScanResult {
  groupId: string;
  groupName: string;
  instanceId: string;
  workflowCount: number;
  detectedEnv: string | null;
  resources: ScannedResource[];
  credentials: ScannedCredential[];
}

/**
 * Scanne un workflow snapshoté (ou tous ceux d'un groupe) : ressources externes et
 * credentials référencés, croisés avec les ResourceMapping existants → sert à
 * pré-remplir les mappings manquants avec les valeurs de l'env courant du workflow.
 */
@Injectable()
export class WorkflowScannerService {
  constructor(private readonly prisma: PrismaService) {}

  async scan(workflowId: string): Promise<WorkflowScanResult> {
    const workflow = await this.prisma.workflow.findUnique({ where: { id: workflowId } });
    if (!workflow) throw new NotFoundException(`Workflow ${workflowId} inconnu`);

    const index = await this.buildMappingIndex();
    const resourceMap = new Map<string, ScannedResource>();
    const credentialMap = new Map<string, ScannedCredential>();
    this.accumulate(workflow.raw as unknown as N8nWorkflow, workflow.name, index, resourceMap, credentialMap);

    const resources = [...resourceMap.values()];
    const credentials = [...credentialMap.values()];
    return {
      workflowId,
      workflowName: workflow.name,
      detectedEnv: dominantEnv(resources, credentials),
      resources,
      credentials,
    };
  }

  /** Scan agrégé de tous les workflows d'un groupe. */
  async scanGroup(groupId: string): Promise<GroupScanResult> {
    const group = await this.prisma.workflowGroup.findUnique({
      where: { id: groupId },
      include: { workflows: { select: { id: true, name: true, raw: true }, orderBy: { name: 'asc' } } },
    });
    if (!group) throw new NotFoundException(`Groupe ${groupId} inconnu`);

    const index = await this.buildMappingIndex();
    const resourceMap = new Map<string, ScannedResource>();
    const credentialMap = new Map<string, ScannedCredential>();
    for (const workflow of group.workflows) {
      this.accumulate(
        workflow.raw as unknown as N8nWorkflow,
        workflow.name,
        index,
        resourceMap,
        credentialMap,
      );
    }

    const resources = [...resourceMap.values()];
    const credentials = [...credentialMap.values()];
    return {
      groupId: group.id,
      groupName: group.name,
      instanceId: group.instanceId,
      workflowCount: group.workflows.length,
      detectedEnv: dominantEnv(resources, credentials),
      resources,
      credentials,
    };
  }

  /** Index id → mapping qui le contient (premier trouvé), tous envs confondus. */
  private async buildMappingIndex(): Promise<Map<string, MappingHit>> {
    const mappings = await this.prisma.resourceMapping.findMany();
    const index = new Map<string, MappingHit>();
    const walk = (value: unknown, env: string, key: string, hit: Omit<MappingHit, 'env' | 'key'>): void => {
      if (typeof value === 'string' && value.length >= 4) {
        if (!index.has(value)) index.set(value, { ...hit, env, key });
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [k, v] of Object.entries(value)) walk(v, env, k, hit);
      }
    };
    for (const mapping of mappings) {
      const values = (mapping.values ?? {}) as Record<string, unknown>;
      for (const [env, envValues] of Object.entries(values)) {
        walk(envValues, env, '', { mappingId: mapping.id, logicalName: mapping.logicalName });
      }
    }
    return index;
  }

  /** Fusionne les refs + credentials d'un workflow dans les accumulateurs partagés. */
  private accumulate(
    raw: N8nWorkflow,
    workflowName: string,
    index: Map<string, MappingHit>,
    resourceMap: Map<string, ScannedResource>,
    credentialMap: Map<string, ScannedCredential>,
  ): void {
    for (const ref of extractResourceRefs(raw)) {
      const scanned = toScannedIds(ref);
      if (!scanned) continue;
      const existing = resourceMap.get(scanned.groupKey);
      if (!existing) {
        resourceMap.set(scanned.groupKey, {
          provider: ref.provider,
          groupKey: scanned.groupKey,
          label: ref.label,
          nodeNames: [ref.nodeName],
          workflows: [workflowName],
          ids: scanned.ids.map((i) => ({ ...i, mapping: index.get(i.id) })),
        });
        continue;
      }
      pushUnique(existing.nodeNames, ref.nodeName);
      pushUnique(existing.workflows, workflowName);
      existing.label ??= ref.label;
      for (const id of scanned.ids) {
        if (!existing.ids.some((known) => known.id === id.id)) {
          existing.ids.push({ ...id, mapping: index.get(id.id) });
        }
      }
    }

    for (const node of raw.nodes ?? []) {
      for (const [type, credential] of Object.entries(node.credentials ?? {})) {
        if (!credential?.id) continue;
        const key = `${type}:${credential.id}`;
        const existing = credentialMap.get(key);
        if (existing) {
          pushUnique(existing.nodeNames, node.name);
          pushUnique(existing.workflows, workflowName);
        } else {
          credentialMap.set(key, {
            type,
            id: credential.id,
            name: credential.name,
            nodeNames: [node.name],
            workflows: [workflowName],
            mapping: index.get(credential.id),
          });
        }
      }
    }
  }
}

function pushUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

/** Env le plus représenté parmi les ids déjà mappés. */
function dominantEnv(resources: ScannedResource[], credentials: ScannedCredential[]): string | null {
  const counts: Record<string, number> = {};
  const hits = [
    ...resources.flatMap((r) => r.ids.map((i) => i.mapping)),
    ...credentials.map((c) => c.mapping),
  ];
  for (const hit of hits) {
    if (hit) counts[hit.env] = (counts[hit.env] ?? 0) + 1;
  }
  const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);
  return sorted[0]?.[0] ?? null;
}

/** Décompose une ref en ids mappables + clé de regroupement. null si provider non mappable (http…). */
function toScannedIds(ref: ResourceRef): { groupKey: string; ids: ScannedId[] } | null {
  const label = ref.label;
  switch (ref.provider) {
    case 'airtable': {
      const base = ref.detail?.['base'];
      if (!base) return null;
      const table = ref.detail?.['table'];
      const ids: ScannedId[] = [{ id: base, suggestedKey: 'baseId' }];
      if (table) {
        // label = "Base — Table" quand n8n fournit les noms lisibles
        const tableName = label?.includes(' — ') ? label.split(' — ').pop() : undefined;
        ids.push({ id: table, suggestedKey: `table_${slug(tableName ?? table)}` });
      }
      return { groupKey: `airtable:${base}`, ids };
    }
    case 'google-sheets': {
      const doc = ref.key.slice('sheets:'.length);
      return { groupKey: ref.key, ids: [{ id: doc, suggestedKey: 'spreadsheetId' }] };
    }
    case 'notion': {
      const db = ref.key.slice('notion:'.length);
      return { groupKey: ref.key, ids: [{ id: db, suggestedKey: `db_${slug(label ?? 'notion')}` }] };
    }
    case 'nocodb': {
      const [project, table] = ref.key.slice('nocodb:'.length).split('/');
      const ids: ScannedId[] = [];
      if (project && project !== '?') ids.push({ id: project, suggestedKey: 'projectId' });
      if (table) ids.push({ id: table, suggestedKey: `table_${slug(table)}` });
      return ids.length > 0 ? { groupKey: `nocodb:${project}`, ids } : null;
    }
    case 'postgres': {
      const table = ref.key.slice('postgres:'.length);
      return { groupKey: ref.key, ids: [{ id: table, suggestedKey: `table_${slug(table)}` }] };
    }
    default:
      return null; // http, execute-workflow : pas de mapping de ressource
  }
}
