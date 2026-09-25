import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Finding, ModelAuditSettings } from '@prisma/client';
import { LLM_TASKS, LLM_TASK_LABELS } from '@nwm/core';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';
import { MODEL_AUDIT_MANIFEST } from './manifest';
import { AuditRunResult, ModelAuditService, ModelParcSummary } from './model-audit.service';
import { ModelAuditSettingsInput, ModelAuditSettingsService } from './model-audit-settings.service';
import { LifecycleCheckResult, LifecycleWatchService } from './lifecycle-watch.service';
import { TaskClassifierService } from './task-classifier.service';

@ModuleId(MODEL_AUDIT_MANIFEST.id)
@Controller('model-audit')
export class ModelAuditController {
  constructor(
    private readonly audit: ModelAuditService,
    private readonly settings: ModelAuditSettingsService,
    private readonly lifecycle: LifecycleWatchService,
    private readonly tasks: TaskClassifierService,
  ) {}

  /** Audit à la demande : tout le parc, une instance, ou un workflow. */
  @Post('run')
  async run(
    @Query('instanceId') instanceId?: string,
    @Query('workflowId') workflowId?: string,
    @Body() body?: { disabled?: string[] },
  ): Promise<AuditRunResult> {
    if (workflowId) {
      const findings = await this.audit.auditWorkflow(workflowId, body?.disabled);
      return {
        workflows: 1,
        skipped: 0,
        findings: findings.length,
        catalogStale: false,
        catalogAgeDays: null,
      };
    }
    return this.audit.auditAll(instanceId);
  }

  /** La vue de parc : une ligne par modèle. */
  @Get('summary')
  summary(): Promise<ModelParcSummary> {
    return this.audit.summary();
  }

  @Get('settings')
  getSettings(): Promise<ModelAuditSettings> {
    return this.settings.get();
  }

  @Put('settings')
  updateSettings(@Body() input: ModelAuditSettingsInput): Promise<ModelAuditSettings> {
    return this.settings.update(input);
  }

  /** Contrôle immédiat du cycle de vie, sans attendre le cron. */
  @Post('lifecycle-check')
  lifecycleCheck(): Promise<LifecycleCheckResult> {
    return this.lifecycle.check();
  }

  /** Les tâches classées d'un workflow, avec la phrase qui a produit l'étiquette. */
  @Get('tasks/:workflowId')
  tasksOf(@Param('workflowId') workflowId: string) {
    return this.tasks.verdicts(workflowId);
  }

  /**
   * Corriger une étiquette à la main. Elle ne sera plus jamais réécrite par
   * l'IA : c'est le seul jugement de cette page qui ne se discute pas.
   */
  @Put('tasks/:workflowId/:nodeName')
  setTask(
    @Param('workflowId') workflowId: string,
    @Param('nodeName') nodeName: string,
    @Body() body: { task: string },
  ) {
    return this.tasks.setManual(workflowId, nodeName, body.task);
  }

  /** Le vocabulaire des tâches, pour que l'UI ne le recopie pas. */
  @Get('task-labels')
  taskLabels(): Array<{ task: string; label: string }> {
    return LLM_TASKS.map((task) => ({ task, label: LLM_TASK_LABELS[task] }));
  }

  /** Findings de ce module pour un workflow (raccourci de la page workflow). */
  @Get('findings/:workflowId')
  findings(@Param('workflowId') workflowId: string): Promise<Finding[]> {
    return this.audit.auditWorkflow(workflowId);
  }
}
