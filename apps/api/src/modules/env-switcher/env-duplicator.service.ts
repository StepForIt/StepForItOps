import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  EnvName,
  N8N_API_PORT,
  N8nApiPort,
  N8nWorkflow,
  Readiness,
  WebhookPathChange,
  applyEnvWebhookPaths,
  duplicationReadiness,
  envIds,
  extractSubWorkflowRefs,
  remapSubWorkflowRefs,
  withEnvSuffix,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { WorkflowSyncService } from '../workflows/workflow-sync.service';
import { InstancesService } from '../instances/instances.service';
import { buildReplacements } from './mapping-replacements';
import { CopyPreview, SwitchedResource, previewCopy } from './copy-preview';
import { switchResources, toSwitchMappings } from './switch-resources';
import { ensureEnvTags } from './ensure-env-tags';
import {
  SubWorkflowMapping,
  resolveSubWorkflows,
  subWorkflowTargets,
  targetWorkflows,
} from './sub-workflow-mapping';

export interface DuplicateResult {
  newN8nId?: string;
  newName: string;
  replacements: number;
  /** Ressources basculées dont le nom affiché a changé, par nœud. */
  switched: SwitchedResource[];
  localWorkflowId?: string;
  /** Sous-workflows appelés et ce qu'ils visent dans la copie. */
  subWorkflows: SubWorkflowMapping[];
  /** Copies créées en cascade pour les sous-workflows qui n'en avaient pas encore. */
  cascaded: Array<{ sourceName: string; newName: string }>;
  /** Webhooks dont le path a été suffixé pour ne pas retomber sur celui de l'original. */
  webhookPaths: WebhookPathChange[];
  /** Nœuds épinglés dans la copie : ils ne s'exécuteront pas. */
  pinned: string[];
  /** Nœuds demandés mais que n8n n'a pas épinglés : ils partiraient pour de vrai. */
  pinsLost: string[];
}

export interface DuplicatePreview extends CopyPreview {
  sourceName: string;
  /** Ce qu'il reste à décider avant de copier — lu par les actions groupées. */
  readiness: Readiness;
}

/** Sortie factice d'un nœud épinglé, marquée pour ne jamais passer pour une vraie. */
function buildPins(nodeNames: string[]): Record<string, unknown[]> {
  return Object.fromEntries(
    nodeNames.map((nodeName) => [nodeName, [{ json: { __bouchon: true, noeud: nodeName } }]]),
  );
}

/**
 * "Dupliquer vers env" : clone le workflow sur la même instance n8n avec
 * les ressources basculées vers l'env cible, le nom suffixé et le tag env:<cible>.
 */
@Injectable()
export class EnvDuplicatorService {
  private readonly logger = new Logger(EnvDuplicatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowsService,
    private readonly sync: WorkflowSyncService,
    private readonly instances: InstancesService,
    @Inject(N8N_API_PORT) private readonly n8n: N8nApiPort,
    private readonly settings: PlatformSettingsService,
  ) {}

  /**
   * Ce que la copie serait, sans rien écrire. Les noms sont relus de n8n : la
   * duplication CRÉE sans apparier, et une copie faite depuis le dernier cron
   * serait sinon doublée.
   */
  async previewDuplicate(workflowId: string, targetEnv: EnvName): Promise<DuplicatePreview> {
    const { workflow, raw } = await this.workflows.getRaw(workflowId);
    const config = await this.instances.getConfig(workflow.instanceId);
    const mappings = toSwitchMappings(await this.prisma.resourceMapping.findMany());
    const copy = previewCopy(
      { name: workflow.name, raw: raw as unknown as N8nWorkflow },
      {
        targetEnv,
        envs: await this.settings.declaredEnvIds(),
        existingNames: new Set((await this.n8n.listWorkflows(config)).map((w) => w.name)),
        replacements: mappings.flatMap((mapping) => buildReplacements(mapping.values, targetEnv)),
        mappings,
      },
    );
    return { sourceName: workflow.name, ...copy, readiness: duplicationReadiness(copy) };
  }

  /**
   * `cascade` : duplique d'abord les sous-workflows appelés qui n'ont pas encore de
   * copie dans l'env cible, les plus profonds en tête. Rien n'est modifié au passage —
   * une copie déjà présente sous le nom attendu est simplement réutilisée.
   *
   * `pinNodes` : nœuds de la copie à épingler (`pinData`), pour qu'un envoi qui n'a
   * pas de contrepartie dans l'env cible — un mail, un message — ne parte pas quand
   * on essaie la copie. Ils ne valent que pour CE workflow : la cascade ne les hérite
   * pas, les noms de nœuds d'un sous-workflow n'ont rien à voir.
   */
  async duplicateToEnv(
    workflowId: string,
    targetEnv: EnvName,
    options: { cascade?: boolean; pinNodes?: string[] } = {},
    seen: Set<string> = new Set(),
  ): Promise<DuplicateResult> {
    const { workflow, raw } = await this.workflows.getRaw(workflowId);
    const config = await this.instances.getConfig(workflow.instanceId);
    seen.add(workflow.id);

    // 1. Bascule des ressources vers l'env cible (ids ET noms affichés)
    const declaredEnvs = await this.settings.declaredEnvs();
    const envs = envIds(declaredEnvs);
    const mappings = await this.prisma.resourceMapping.findMany();
    const outcome = switchResources(
      raw as unknown as N8nWorkflow,
      toSwitchMappings(mappings),
      targetEnv,
      envs,
    );
    const switched = outcome.workflow;
    const applied = outcome.replacements;

    // 2. Sous-workflows appelés → leur copie « - ENV » quand elle existe déjà. Sans ça,
    // la copie dev rappelle les sous-workflows d'origine : mélange d'envs, et refus net
    // de n8n dès que l'appelé restreint qui peut l'appeler.
    const refs = extractSubWorkflowRefs(switched);
    const subWorkflows = resolveSubWorkflows(refs, {
      sourceNames: new Map(
        (
          await this.prisma.workflow.findMany({
            where: { instanceId: workflow.instanceId, externalId: { in: refs.map((ref) => ref.externalId) } },
            select: { externalId: true, name: true },
          })
        ).map((row) => [row.externalId, row.name] as const),
      ),
      targets: targetWorkflows(await this.n8n.listWorkflows(config)),
      targetEnv,
      sameInstance: true,
    });
    // 3. Cascade : les sous-workflows sans copie dans l'env cible sont dupliqués d'abord,
    // puis on re-résout — c'est à ce moment-là que la copie fraîche devient la cible.
    const cascaded: DuplicateResult['cascaded'] = [];
    if (options.cascade) {
      for (const missing of subWorkflows.filter((sub) => sub.status === 'missing')) {
        const local = await this.prisma.workflow.findFirst({
          where: { instanceId: workflow.instanceId, externalId: missing.sourceN8nId },
          select: { id: true, name: true },
        });
        // Inconnu de la plateforme, ou déjà en cours de duplication (récursion) : on laisse.
        if (!local || seen.has(local.id)) continue;
        const child = await this.duplicateToEnv(local.id, targetEnv, { cascade: true }, seen);
        cascaded.push({ sourceName: local.name, newName: child.newName }, ...child.cascaded);
        if (child.newN8nId) {
          missing.targetN8nId = child.newN8nId;
          missing.targetName = child.newName;
          missing.status = 'mapped';
        }
      }
    }

    const remappedRefs = remapSubWorkflowRefs(switched, subWorkflowTargets(subWorkflows)).workflow;

    // 3 bis. Webhooks : leur path est enregistré par n8n à l'échelle de l'instance. Gardé
    // tel quel, il reste tenu par l'exemplaire actif — la copie ne serait jamais appelée,
    // et la tester déclencherait l'original.
    const webhooks = applyEnvWebhookPaths(remappedRefs, targetEnv, randomUUID, declaredEnvs);
    const candidate = webhooks.workflow;

    // 4. Création de la copie (inactive) avec le nom suffixé, les nœuds choisis épinglés
    const newName = withEnvSuffix(workflow.name, targetEnv, envs);
    const pinData = { ...(candidate.pinData ?? {}), ...buildPins(options.pinNodes ?? []) };
    const created = await this.n8n.createWorkflow(config, {
      ...candidate,
      id: undefined,
      name: newName,
      active: false,
      pinData,
    });
    const newN8nId = created.id !== undefined ? String(created.id) : undefined;

    // 5. Tags : ceux d'origine (hors env:*) + env:<cible>
    if (newN8nId) {
      await ensureEnvTags(this.n8n, config, newN8nId, workflow.tags, targetEnv).catch((error) =>
        this.logger.warn(`Tags failed on the copy "${newName}": ${(error as Error).message}`),
      );
    }

    // 6. Sync immédiat de la copie en DB (émet workflow.synced → versioning etc.).
    // La copie relue sert aussi de preuve : un pinData que n8n n'a pas retenu, c'est
    // un envoi réel au premier essai — mieux vaut le dire que la croire bouchonnée.
    let localWorkflowId: string | undefined;
    const pinsLost: string[] = [];
    if (newN8nId) {
      const fresh = await this.n8n.getWorkflow(config, newN8nId);
      pinsLost.push(...(options.pinNodes ?? []).filter((nodeName) => !fresh.pinData?.[nodeName]));
      const event = await this.sync.upsertWorkflow(workflow.instanceId, fresh);
      localWorkflowId = event.workflowId;
    }

    if (pinsLost.length > 0) {
      this.logger.warn(`Copy "${newName}": n8n did not pin ${pinsLost.join(', ')}`);
    }

    const remapped = subWorkflows.filter((sub) => sub.status === 'mapped').length;
    this.logger.log(
      `"${workflow.name}" duplicated to ${targetEnv}: "${newName}" (${applied} replacements` +
        `${remapped > 0 ? `, ${remapped} sub-workflow(s) remapped` : ''}` +
        `${cascaded.length > 0 ? `, ${cascaded.length} cascaded copies` : ''}` +
        `${webhooks.changes.length > 0 ? `, ${webhooks.changes.length} webhook(s) re-pathed` : ''})`,
    );
    return {
      newN8nId,
      newName,
      replacements: applied,
      switched: outcome.relabeled,
      localWorkflowId,
      subWorkflows,
      cascaded,
      webhookPaths: webhooks.changes,
      pinned: options.pinNodes ?? [],
      pinsLost,
    };
  }
}
