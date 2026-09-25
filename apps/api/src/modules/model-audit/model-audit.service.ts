import { Injectable, Logger } from '@nestjs/common';
import { Finding } from '@prisma/client';
import {
  CheckFinding,
  N8nWorkflow,
  detectWorkflowEnv,
  isModuleFullyDisabled,
  llmNodeRequirements,
  runModelAudit,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { CheckProfilesService } from '../../infra/check-profiles/check-profiles.service';
import { ModelCatalogService } from '../../infra/model-catalog/model-catalog.service';
import { FindingIgnoreService } from '../workflows/finding-ignore.service';
import { MODEL_AUDIT_MANIFEST } from './manifest';
import { ModelAuditSettingsService } from './model-audit-settings.service';
import { NodeUsageService } from './node-usage.service';
import { TaskClassifierService } from './task-classifier.service';

export interface AuditRunResult {
  workflows: number;
  /** Workflows sans nœud LLM : ni audités, ni comptés en échec. */
  skipped: number;
  findings: number;
  /** Vrai quand le catalogue est trop vieux : tout ce qui en dépend s'est tu. */
  catalogStale: boolean;
  catalogAgeDays: number | null;
}

/**
 * L'audit lui-même : il assemble ce que les règles pures attendent (le contenu
 * du workflow, le catalogue, les mesures, les tâches) et range ce qu'elles
 * rendent dans les findings ordinaires.
 *
 * Le déclencheur n'est pas la modification d'un workflow mais celle du monde :
 * d'où le cron. C'est aussi pour ça que la lecture part du MIROIR et non de
 * n8n — l'audit n'écrit rien, et redemander tout le parc à chaque passe coûterait
 * un appel par workflow pour un contenu que la synchro horaire tient à jour.
 */
@Injectable()
export class ModelAuditService {
  private readonly logger = new Logger(ModelAuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
    private readonly profiles: CheckProfilesService,
    private readonly catalog: ModelCatalogService,
    private readonly usage: NodeUsageService,
    private readonly tasks: TaskClassifierService,
    private readonly ignores: FindingIgnoreService,
    private readonly auditSettings: ModelAuditSettingsService,
  ) {}

  /** Un workflow. Renvoie les findings persistés. */
  async auditWorkflow(workflowId: string, disabledChecks?: string[]): Promise<Finding[]> {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
      include: { instance: { select: { platform: true } } },
    });
    if (!workflow) return [];
    // Make : les modules `openai:*` d'un blueprint portent bien un modèle, nous
    // ne l'avons pas encore lu. Une dette, pas une limite du fournisseur — et
    // elle se dit à l'écran plutôt que de produire un audit vide qui rassure.
    if (workflow.instance.platform !== 'n8n') return [];

    const disabled = await this.profiles.effective(workflowId, disabledChecks);
    if (isModuleFullyDisabled(disabled, 'model-audit')) return [];

    const raw = workflow.raw as unknown as N8nWorkflow;
    const requirements = llmNodeRequirements(raw);
    if (requirements.length === 0) {
      await this.prisma.finding.deleteMany({ where: { workflowId, module: MODEL_AUDIT_MANIFEST.id } });
      return [];
    }

    const [entries, taskProfiles, freshness, thresholds] = await Promise.all([
      this.catalog.entries(),
      this.catalog.taskProfiles(),
      this.catalog.freshness(),
      this.auditSettings.get(),
    ]);
    const usageByNode = await this.usage.byNode(workflow.instanceId, workflow.externalId);
    const taskByNode = await this.tasks.classify(workflow, requirements);

    const off = new Set(disabled);
    const found = runModelAudit({
      requirements,
      catalog: entries,
      usageByNode,
      taskByNode,
      taskProfiles,
      catalogStale: freshness.ageDays !== null && freshness.ageDays > thresholds.catalogStaleDays,
      thresholds: {
        savingsThresholdPct: thresholds.savingsThresholdPct,
        minAnnualSavingsUsd: thresholds.minAnnualSavingsUsd,
        minTaskConfidence: thresholds.minTaskConfidence,
      },
    }).filter((finding) => !off.has(finding.code));

    return this.persist(workflowId, found);
  }

  /** Tout le parc (le cron, et le bouton « Auditer »). */
  async auditAll(instanceId?: string): Promise<AuditRunResult> {
    const filter = await this.settings.workflowFilter();
    const workflows = await this.prisma.workflow.findMany({
      where: { ...filter, ...(instanceId ? { instanceId } : {}), instance: { platform: 'n8n' } },
      select: { id: true },
    });
    const freshness = await this.catalog.freshness();
    const settings = await this.auditSettings.get();

    let findings = 0;
    let audited = 0;
    let skipped = 0;
    for (const workflow of workflows) {
      try {
        const produced = await this.auditWorkflow(workflow.id);
        if (produced.length === 0) skipped++;
        findings += produced.length;
        audited++;
      } catch (error) {
        // Un workflow illisible ne doit pas priver le parc de sa passe.
        this.logger.warn(`Audit de ${workflow.id} KO : ${(error as Error).message}`);
      }
    }
    return {
      workflows: audited,
      skipped,
      findings,
      catalogStale: freshness.ageDays !== null && freshness.ageDays > settings.catalogStaleDays,
      catalogAgeDays: freshness.ageDays,
    };
  }

  /**
   * La vue de PARC : une ligne par modèle. C'est ici que « 14 workflows sur un
   * modèle retiré en janvier » se lit — un finding par workflow le dirait
   * quatorze fois sans jamais le dire.
   */
  async summary(): Promise<ModelParcSummary> {
    const filter = await this.settings.workflowFilter();
    const workflows = await this.prisma.workflow.findMany({
      where: { ...filter, instance: { platform: 'n8n' } },
      select: { id: true, name: true, tags: true, raw: true, instanceId: true, externalId: true },
    });
    const [entries, freshness, costByModel, settings] = await Promise.all([
      this.catalog.entries(),
      this.catalog.freshness(),
      this.usage.byModel(),
      this.auditSettings.get(),
    ]);
    const taskRows = await this.prisma.llmNodeTask.findMany();
    const tasksByWorkflowNode = new Map(
      taskRows.map((row) => [`${row.workflowId}|${row.nodeName}`, row.task]),
    );

    const byModel = new Map<string, ModelParcRow>();
    for (const workflow of workflows) {
      const requirements = llmNodeRequirements(workflow.raw as unknown as N8nWorkflow);
      for (const requirement of requirements) {
        if (!requirement.model) continue;
        const key = requirement.model.toLowerCase();
        const entry = entries.find((candidate) => key.startsWith(candidate.pattern.toLowerCase()));
        const row = byModel.get(key) ?? {
          model: requirement.model,
          provider: entry?.provider ?? null,
          status: entry?.status ?? null,
          retiresAt: entry?.retiresAt ?? null,
          replacedByPattern: entry?.replacedByPattern ?? null,
          tier: entry?.tier ?? null,
          known: Boolean(entry),
          nodes: 0,
          workflows: 0,
          costUsd30d: costByModel.get(key)?.costUsd ?? 0,
          calls30d: costByModel.get(key)?.calls ?? 0,
          tasks: {} as Record<string, number>,
          workflowNames: [] as string[],
        };
        row.nodes++;
        if (!row.workflowNames.includes(workflow.name)) {
          row.workflowNames.push(workflow.name);
          row.workflows++;
        }
        const task = tasksByWorkflowNode.get(`${workflow.id}|${requirement.nodeName}`);
        if (task) row.tasks[task] = (row.tasks[task] ?? 0) + 1;
        byModel.set(key, row);
      }
    }

    return {
      models: [...byModel.values()].sort((a, b) => b.costUsd30d - a.costUsd30d),
      freshness: {
        checkedAt: freshness.checkedAt?.toISOString() ?? null,
        ageDays: freshness.ageDays,
        stale: freshness.ageDays !== null && freshness.ageDays > settings.catalogStaleDays,
        staleAfterDays: settings.catalogStaleDays,
      },
    };
  }

  /** Les workflows qui portent un modèle donné, pour un message d'alerte actionnable. */
  async workflowsUsing(
    pattern: string,
  ): Promise<Array<{ name: string; env: string | null; nodeName: string }>> {
    const filter = await this.settings.workflowFilter();
    const workflows = await this.prisma.workflow.findMany({
      where: { ...filter, instance: { platform: 'n8n' } },
      select: { name: true, tags: true, raw: true },
    });
    const touched: Array<{ name: string; env: string | null; nodeName: string }> = [];
    const envs = await this.settings.declaredEnvIds();
    for (const workflow of workflows) {
      for (const requirement of llmNodeRequirements(workflow.raw as unknown as N8nWorkflow)) {
        if (!requirement.model?.toLowerCase().startsWith(pattern.toLowerCase())) continue;
        touched.push({
          name: workflow.name,
          env: detectWorkflowEnv(workflow.name, workflow.tags, envs),
          nodeName: requirement.nodeName,
        });
      }
    }
    return touched;
  }

  private async persist(workflowId: string, found: CheckFinding[]): Promise<Finding[]> {
    const { kept } = await this.ignores.filterIgnored(workflowId, MODEL_AUDIT_MANIFEST.id, found);
    await this.prisma.finding.deleteMany({ where: { workflowId, module: MODEL_AUDIT_MANIFEST.id } });
    await this.prisma.finding.createMany({
      data: kept.map((finding) => ({
        workflowId,
        module: MODEL_AUDIT_MANIFEST.id,
        severity: finding.severity,
        code: finding.code,
        message: finding.message,
        nodeName: finding.nodeName,
        data: finding.data as object | undefined,
      })),
    });
    return this.prisma.finding.findMany({ where: { workflowId, module: MODEL_AUDIT_MANIFEST.id } });
  }
}

export interface ModelParcRow {
  model: string;
  provider: string | null;
  status: string | null;
  retiresAt: string | null;
  replacedByPattern: string | null;
  tier: string | null;
  known: boolean;
  nodes: number;
  workflows: number;
  costUsd30d: number;
  calls30d: number;
  /** Répartition des tâches classées : ce qui fait comprendre d'un coup d'œil le gâchis. */
  tasks: Record<string, number>;
  workflowNames: string[];
}

export interface ModelParcSummary {
  models: ModelParcRow[];
  freshness: {
    checkedAt: string | null;
    ageDays: number | null;
    stale: boolean;
    staleAfterDays: number;
  };
}
