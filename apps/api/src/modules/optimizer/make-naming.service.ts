import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  AI_PORT,
  AiPort,
  EVENTS,
  MakeBlueprint,
  flattenModules,
  isMakeBlueprint,
  moduleLabel,
  redactSecrets,
  renameModules,
  unnamedModules,
} from '@nwm/core';
import { EnvChainGuardService } from '../../infra/settings/env-chain-guard.service';
import { EventBusService } from '../../infra/events/event-bus.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { WorkflowSyncService } from '../workflows/workflow-sync.service';
import { InstancesService } from '../instances/instances.service';
import type { RenameSuggestion, RenameWithNote, SuggestNamesOptions } from './optimizer.service';
import { WorkflowLockService } from '../../infra/workflow-lock/workflow-lock.service';

/**
 * Le naming des modules d'un scénario Make : proposer des noms, puis les écrire.
 *
 * Il n'y a rien à réécrire autour d'un nom — les expressions Make visent l'id —,
 * d'où un service bien plus court que le renommage n8n. Le module est désigné par
 * son id de bout en bout : deux modules non nommés d'un même type portent le même
 * libellé, et un nom ne suffirait pas à dire lequel renommer.
 */
@Injectable()
export class MakeNamingService {
  private readonly logger = new Logger(MakeNamingService.name);

  constructor(
    private readonly eventBus: EventBusService,
    private readonly workflows: WorkflowsService,
    private readonly sync: WorkflowSyncService,
    private readonly instances: InstancesService,
    private readonly envChain: EnvChainGuardService,
    @Inject(AI_PORT) private readonly ai: AiPort,
    private readonly locks: WorkflowLockService,
  ) {}

  async suggestNames(
    blueprint: unknown,
    { language = 'en', scope = 'default-names' }: SuggestNamesOptions,
  ): Promise<RenameSuggestion[]> {
    if (!isMakeBlueprint(blueprint)) return [];
    const candidates = scope === 'all' ? flattenModules(blueprint) : unnamedModules(blueprint);
    if (candidates.length === 0) return [];

    const byId = new Map(candidates.map((flat) => [flat.module.id, flat.module]));
    // Les réglages d'un module peuvent porter une clé d'API en clair : l'IA a
    // besoin de voir ce que fait le module, jamais la valeur du secret.
    const modules = candidates.map(({ module }) =>
      redactSecrets({
        moduleId: module.id,
        name: moduleLabel(module),
        module: module.module,
        mapper: module.mapper,
        parameters: module.parameters,
      }),
    );
    const mission =
      scope === 'all'
        ? "Tu uniformises le naming de TOUS les modules d'un scénario Make : même langue et même style " +
          '(verbe + objet) pour tous. Ne renvoie QUE les modules dont le nom doit changer.'
        : "Tu nommes des modules d'un scénario Make laissés sans nom (leur libellé actuel n'est que leur type).";
    const naming =
      language === 'en'
        ? 'Propose un nom court EN ANGLAIS décrivant l\'action (ex: "Fetch Airtable orders", "Filter active clients").'
        : 'Propose un nom court EN FRANÇAIS décrivant l\'action (ex: "Récupérer commandes Airtable", "Filtrer clients actifs").';

    try {
      const answer = await this.ai.generateJson<
        Array<{ moduleId: number; newName: string; reason?: string }>
      >({
        system:
          `${mission} ${naming} Chaque module est désigné par son "moduleId" : recopie-le tel quel. ` +
          'Réponds en JSON: [{"moduleId": 3, "newName": "...", "reason": "..."}]',
        prompt: JSON.stringify(modules),
        maxTokens: 8192,
      });
      return answer
        .filter((item) => byId.has(item.moduleId) && item.newName?.trim())
        .map((item) => ({
          moduleId: item.moduleId,
          oldName: moduleLabel(byId.get(item.moduleId)!),
          newName: item.newName.trim(),
          reason: item.reason ?? '',
        }))
        .filter((suggestion) => suggestion.newName !== suggestion.oldName);
    } catch (error) {
      this.logger.warn(`Suggestions IA (Make) KO : ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Repart du scénario tel que Make le sert : le blueprint est réécrit EN ENTIER,
   * et partir du miroir local renverrait l'état du dernier cron — ce qui a été
   * fait dans Make entre-temps serait écrasé sans que rien ne le dise. Une note
   * n'est jamais écrite : Make n'en porte pas au niveau du module.
   */
  async applyRenames(workflowId: string, renames: RenameWithNote[]): Promise<{ renamed: number }> {
    const missingId = renames.filter((rename) => typeof rename.moduleId !== 'number');
    if (missingId.length > 0) {
      throw new BadRequestException(
        `Un module Make se renomme par son id : absent pour ${missingId.map((r) => `« ${r.oldName} »`).join(', ')}`,
      );
    }
    await this.envChain.assertDirectWriteAllowed(workflowId);
    await this.locks.assertWritable(workflowId);
    const { workflow, raw, missing } = await this.workflows.getFreshRawAny(workflowId);
    if (missing) {
      throw new BadRequestException(`« ${workflow.name} » n'existe plus dans Make : rien n'est renommé.`);
    }

    let updated: MakeBlueprint;
    try {
      updated = renameModules(
        raw,
        renames.map((rename) => ({ moduleId: rename.moduleId as number, newName: rename.newName })),
      );
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const { port, config } = await this.instances.getPlatformConfig(workflow.instanceId);
    await port.updateWorkflow(config, workflow.externalId, updated);
    // Resync (émet workflow.synced, donc une version) : les analyses relisent sinon l'ancien blueprint.
    await this.sync.syncWorkflow(workflowId);

    this.eventBus.emit(EVENTS.optimizerApplied, { workflowId, renamed: renames.length });
    return { renamed: renames.length };
  }
}
