import { Injectable } from '@nestjs/common';
import {
  EVENTS,
  FieldCheckCompletedEvent,
  N8nWorkflow,
  NodeSamples,
  isModuleFullyDisabled,
  checkFieldRefs,
  extractFieldRefs,
} from '@nwm/core';
import { Finding } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EventBusService } from '../../infra/events/event-bus.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { FindingIgnoreService } from '../workflows/finding-ignore.service';
import { CheckProfilesService } from '../../infra/check-profiles/check-profiles.service';
import { InstancesService } from '../instances/instances.service';
import { ExecutionSamplerService } from './execution-sampler.service';
import { FIELD_CHECKER_MANIFEST } from './manifest';

export interface FieldCheckResult {
  findings: Finding[];
  /** Schéma observé, par nœud : sert aussi à expliquer un finding dans l'UI. */
  samples: NodeSamples[];
  sampledExecutions: number;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

/**
 * Vérification des champs référencés dans les expressions face au schéma RÉEL
 * observé sur les dernières exécutions (cf. `field-check.ts` dans le domaine).
 */
@Injectable()
export class FieldCheckerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly workflows: WorkflowsService,
    private readonly ignores: FindingIgnoreService,
    private readonly profiles: CheckProfilesService,
    private readonly instances: InstancesService,
    private readonly sampler: ExecutionSamplerService,
  ) {}

  /** Schéma observé seul (sans persistance de findings) : inspection depuis l'UI. */
  async samplesOf(workflowId: string, limit = DEFAULT_LIMIT): Promise<FieldCheckResult> {
    const { samples, sampledExecutions } = await this.collect(workflowId, limit);
    return { findings: [], samples, sampledExecutions };
  }

  /** `disabledChecks` : sélection de l'écran de lancement, prioritaire sur le profil. */
  async check(
    workflowId: string,
    limit = DEFAULT_LIMIT,
    disabledChecks?: string[],
  ): Promise<FieldCheckResult> {
    const disabled = await this.profiles.effective(workflowId, disabledChecks);
    // Les deux contrôles décochés : on n'échantillonne même pas les exécutions.
    // C'est l'appel le plus lourd de la plateforme (includeData sur N exécutions),
    // le filtrage des findings seul l'aurait payé pour rien. Les findings déjà en
    // base partent quand même : un contrôle qu'on vient de retirer ne doit pas
    // continuer à s'afficher jusqu'à la prochaine analyse complète.
    if (isModuleFullyDisabled(disabled, 'field-checker')) {
      await this.prisma.finding.deleteMany({
        where: { workflowId, module: FIELD_CHECKER_MANIFEST.id },
      });
      return { findings: [], samples: [], sampledExecutions: 0 };
    }
    const off = new Set(disabled);
    const { workflow, raw, samples, sampledExecutions } = await this.collect(workflowId, limit);
    const found = checkFieldRefs(extractFieldRefs(raw), samples).filter((finding) => !off.has(finding.code));
    const { kept } = await this.ignores.filterIgnored(workflow.id, FIELD_CHECKER_MANIFEST.id, found);

    await this.prisma.finding.deleteMany({
      where: { workflowId, module: FIELD_CHECKER_MANIFEST.id },
    });
    await this.prisma.finding.createMany({
      data: kept.map((f) => ({
        workflowId,
        module: FIELD_CHECKER_MANIFEST.id,
        severity: f.severity,
        code: f.code,
        message: f.message,
        nodeName: f.nodeName,
        data: f.data as object,
      })),
    });
    const stored = await this.prisma.finding.findMany({
      where: { workflowId, module: FIELD_CHECKER_MANIFEST.id },
    });
    await this.prisma.analysisRun.create({
      data: { workflowId, module: FIELD_CHECKER_MANIFEST.id, findingsCount: stored.length },
    });

    const event: FieldCheckCompletedEvent = {
      workflowId,
      findingsCount: stored.length,
      sampledExecutions,
    };
    this.eventBus.emit(EVENTS.fieldCheckCompleted, event);
    return { findings: stored, samples, sampledExecutions };
  }

  private async collect(workflowId: string, limit: number) {
    const { workflow, raw } = await this.workflows.getRaw(workflowId);
    const config = await this.instances.getConfig(workflow.instanceId);
    const { samples, sampledExecutions } = await this.sampler.sample(
      config,
      workflow.externalId,
      Math.min(Math.max(limit, 1), MAX_LIMIT),
    );
    return { workflow, raw: raw as N8nWorkflow, samples, sampledExecutions };
  }
}
