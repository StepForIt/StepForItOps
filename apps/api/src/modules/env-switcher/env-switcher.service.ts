import { Inject, Injectable } from '@nestjs/common';
import {
  EVENTS,
  EnvSwitchedEvent,
  N8N_API_PORT,
  N8nApiPort,
  EnvName,
  N8nWorkflow,
  previewDeepReplace,
  Replacement,
  ReplacementHit,
  withEnvSuffix,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EnvChainGuardService } from '../../infra/settings/env-chain-guard.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { EventBusService } from '../../infra/events/event-bus.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { WorkflowSyncService } from '../workflows/workflow-sync.service';
import { InstancesService } from '../instances/instances.service';
import { buildReplacements, countEnvMatches, MappingValues } from './mapping-replacements';
import { switchResources, toSwitchMappings } from './switch-resources';
import { SwitchedResource } from './copy-preview';
import { ensureEnvTags } from './ensure-env-tags';
import { UnmappedResource, findUnmappedResources } from './unmapped-resources';
import { WorkflowLockService } from '../../infra/workflow-lock/workflow-lock.service';

export interface CurrentEnvResult {
  /** Env dominant détecté via les ressources présentes dans le JSON (null si aucun id connu). */
  env: string | null;
  /** true si des ids de plusieurs envs cohabitent (bascule partielle / incohérence). */
  mixed: boolean;
  counts: Record<string, number>;
}

export interface SwitchPreview {
  workflowId: string;
  targetEnv: string;
  replacements: Replacement[];
  hits: ReplacementHit[];
  /** Ressources basculées dont le nom affiché change, par nœud. */
  switched: SwitchedResource[];
  /** Ressources basculables du workflow qu'aucun mapping ne couvre : bascule muette dessus. */
  unmapped: UnmappedResource[];
}

export interface MarkEnvResult {
  tags: string[];
  /** Nouveau nom, si le renommage a été demandé. */
  newName?: string;
}

@Injectable()
export class EnvSwitcherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly workflows: WorkflowsService,
    private readonly sync: WorkflowSyncService,
    private readonly instances: InstancesService,
    private readonly envChain: EnvChainGuardService,
    @Inject(N8N_API_PORT) private readonly n8n: N8nApiPort,
    private readonly settings: PlatformSettingsService,
    private readonly locks: WorkflowLockService,
  ) {}

  private async collectReplacements(targetEnv: string): Promise<Replacement[]> {
    const mappings = await this.prisma.resourceMapping.findMany();
    return mappings.flatMap((mapping) =>
      buildReplacements(mapping.values as unknown as MappingValues, targetEnv),
    );
  }

  /** Env courant d'un workflow, détecté par les ids de ressources présents dans son JSON. */
  async detectCurrentEnv(workflowId: string): Promise<CurrentEnvResult> {
    const { raw } = await this.workflows.getRaw(workflowId);
    const serialized = JSON.stringify(raw);
    const mappings = await this.prisma.resourceMapping.findMany();

    const totals: Record<string, number> = {};
    for (const mapping of mappings) {
      const counts = countEnvMatches(serialized, mapping.values as unknown as MappingValues);
      for (const [env, count] of Object.entries(counts)) {
        totals[env] = (totals[env] ?? 0) + count;
      }
    }
    const present = Object.entries(totals).filter(([, count]) => count > 0);
    present.sort(([, a], [, b]) => b - a);
    return {
      env: present[0]?.[0] ?? null,
      mixed: present.length > 1,
      counts: totals,
    };
  }

  /** Plan de bascule sans modification, trous de mapping compris. */
  async preview(workflowId: string, targetEnv: string): Promise<SwitchPreview> {
    const { raw } = await this.workflows.getRaw(workflowId);
    const mappings = await this.prisma.resourceMapping.findMany();
    const replacements = mappings.flatMap((mapping) =>
      buildReplacements(mapping.values as unknown as MappingValues, targetEnv),
    );
    const hits = previewDeepReplace(raw, replacements);
    const used = new Set(hits.map((h) => h.from));
    const switched = switchResources(
      raw as unknown as N8nWorkflow,
      toSwitchMappings(mappings),
      targetEnv,
      await this.settings.declaredEnvIds(),
    ).relabeled;
    return {
      workflowId,
      targetEnv,
      replacements: replacements.filter((r) => used.has(r.from)),
      hits,
      switched,
      unmapped: findUnmappedResources(
        raw as unknown as N8nWorkflow,
        mappings.map((m) => m.values as unknown as MappingValues),
      ),
    };
  }

  /**
   * Déclare l'environnement d'un workflow SANS toucher à ses données : tag `env:<x>`,
   * et nom suffixé si demandé. C'est ce qui prépare la promotion, dont l'appariement
   * entre instances se fait par le nom — un workflow non étiqueté part sans jumeau.
   */
  async markEnv(workflowId: string, targetEnv: EnvName, rename = false): Promise<MarkEnvResult> {
    await this.locks.assertWritable(workflowId);
    const { workflow, raw } = await this.workflows.getRaw(workflowId);
    const config = await this.instances.getConfig(workflow.instanceId);

    const envs = await this.settings.declaredEnvIds();
    const newName = rename ? withEnvSuffix(workflow.name, targetEnv, envs) : undefined;
    if (newName && newName !== workflow.name) {
      await this.n8n.updateWorkflow(config, workflow.externalId, {
        ...(raw as unknown as N8nWorkflow),
        name: newName,
      });
    }
    await ensureEnvTags(this.n8n, config, workflow.externalId, workflow.tags, targetEnv);

    const fresh = await this.n8n.getWorkflow(config, workflow.externalId);
    await this.sync.upsertWorkflow(workflow.instanceId, fresh);
    return {
      tags: [...workflow.tags.filter((tag) => !tag.toLowerCase().startsWith('env:')), `env:${targetEnv}`],
      newName,
    };
  }

  /** Applique la bascule : remplacement profond + PUT vers n8n. */
  async apply(workflowId: string, targetEnv: string): Promise<{ applied: number; relabeled: number }> {
    // Rebrancher un workflow sur d'autres données, c'est le modifier : mêmes nœuds,
    // autre base. En mode bloquant, cela passe par une promotion comme le reste.
    await this.envChain.assertDirectWriteAllowed(workflowId);
    await this.locks.assertWritable(workflowId);
    const { workflow, raw } = await this.workflows.getRaw(workflowId);
    const replacements = await this.collectReplacements(targetEnv);
    const hits = previewDeepReplace(raw, replacements);
    if (hits.length === 0) return { applied: 0, relabeled: 0 };

    const mappings = await this.prisma.resourceMapping.findMany();
    const switched = switchResources(
      raw as unknown as N8nWorkflow,
      toSwitchMappings(mappings),
      targetEnv,
      await this.settings.declaredEnvIds(),
    );
    const updated = switched.workflow;
    const config = await this.instances.getConfig(workflow.instanceId);
    await this.n8n.updateWorkflow(config, workflow.externalId, updated);

    // Resync immédiat du snapshot local (émet workflow.synced → versioning etc.)
    const fresh = await this.n8n.getWorkflow(config, workflow.externalId);
    await this.sync.upsertWorkflow(workflow.instanceId, fresh);

    const event: EnvSwitchedEvent = { workflowId, targetEnv, replacements: hits.length };
    this.eventBus.emit(EVENTS.envSwitched, event);
    return { applied: hits.length, relabeled: switched.relabeled.length };
  }
}
