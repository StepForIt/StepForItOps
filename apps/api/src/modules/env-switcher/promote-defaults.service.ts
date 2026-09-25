import { Injectable, NotFoundException } from '@nestjs/common';
import { EnvName, detectWorkflowEnv, envIds, nextEnv } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';

export interface PromoteDefaults {
  sourceEnv: EnvName | null;
  targetInstanceId: string;
  /** null : source au bout de la chaîne ou env indéterminé — l'humain choisit. */
  targetEnv: EnvName | null;
}

/**
 * Ce que l'écran de promotion propose d'emblée, d'où qu'on l'ouvre : la même
 * instance (dev et prod y cohabitent le plus souvent) et l'étape suivante de la chaîne.
 */
@Injectable()
export class PromoteDefaultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
  ) {}

  async defaults(workflowId: string): Promise<PromoteDefaults> {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
      select: { name: true, tags: true, instanceId: true },
    });
    if (!workflow) throw new NotFoundException(`Workflow ${workflowId} introuvable`);
    const envs = await this.settings.declaredEnvs();
    const sourceEnv = detectWorkflowEnv(workflow.name, workflow.tags, envIds(envs));
    return { sourceEnv, targetInstanceId: workflow.instanceId, targetEnv: nextEnv(envs, sourceEnv) };
  }
}
