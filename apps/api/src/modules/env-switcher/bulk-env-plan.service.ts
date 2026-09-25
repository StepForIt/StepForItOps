import { BadRequestException, Injectable } from '@nestjs/common';
import {
  BulkEnvAction,
  BulkFamily,
  BulkPlanRow,
  planBulkEnvAction,
  workflowFamilyKey,
  workflowFamilyName,
} from '@nwm/core';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { WorkflowsService } from '../workflows/workflows.service';

export interface BulkEnvPlanInput {
  action: BulkEnvAction;
  /** Clés de famille (`workflowFamilyKey`), telles que la vue groupée les sert en `id`. */
  familyKeys: string[];
  sourceEnv: string | null;
  targetEnv: string;
  fallbackInstanceId?: string;
}

const ACTIONS: BulkEnvAction[] = ['promote', 'duplicate', 'mark'];

/**
 * Résout un lot de workflows métier en gestes à l'unité : quel exemplaire part,
 * vers quelle instance. Ne lit que la base — les previews et les écritures
 * repassent ensuite par les routes de chaque geste, une à une, pour que le lot
 * porte exactement les mêmes gardes qu'un workflow seul.
 */
@Injectable()
export class BulkEnvPlanService {
  constructor(
    private readonly workflows: WorkflowsService,
    private readonly settings: PlatformSettingsService,
  ) {}

  async plan(input: BulkEnvPlanInput): Promise<BulkPlanRow[]> {
    if (!ACTIONS.includes(input.action)) throw new BadRequestException(`Action inconnue : ${input.action}`);
    if (!Array.isArray(input.familyKeys) || input.familyKeys.length === 0) {
      throw new BadRequestException('Aucun workflow métier sélectionné');
    }
    const envs = await this.settings.declaredEnvIds();
    for (const env of [input.sourceEnv, input.targetEnv]) {
      if (env !== null && !envs.includes(env)) throw new BadRequestException(`Env non déclaré : ${env}`);
    }
    if (input.action === 'mark' ? input.sourceEnv !== null : input.sourceEnv === null) {
      throw new BadRequestException(
        input.action === 'mark' ? "Déclarer l'env part des exemplaires sans env" : 'Env source obligatoire',
      );
    }

    const wanted = new Set(input.familyKeys);
    const byKey = new Map<string, BulkFamily>();
    // Archivés compris : un exemplaire rangé dit quand même où vit l'env cible — il n'est juste jamais source.
    for (const workflow of await this.workflows.listAll({ archived: 'all' })) {
      const key = workflowFamilyKey(workflow.name, envs);
      if (!wanted.has(key)) continue;
      const family = byKey.get(key) ?? { key, name: workflowFamilyName(workflow.name, envs), members: [] };
      family.members.push({
        id: workflow.id,
        name: workflow.name,
        env: workflow.env,
        instanceId: workflow.instanceId,
        archived: workflow.archived,
        archivedUpstream: workflow.archivedUpstream,
        missing: workflow.missingInN8n,
      });
      byKey.set(key, family);
    }
    // Une famille demandée mais introuvable (renommée depuis) reste dans le compte rendu.
    const families = input.familyKeys.map((key) => byKey.get(key) ?? { key, name: key, members: [] });

    try {
      return planBulkEnvAction(families, {
        action: input.action,
        sourceEnv: input.sourceEnv,
        targetEnv: input.targetEnv,
        fallbackInstanceId: input.fallbackInstanceId,
      });
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }
}
