import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  assessImpact,
  ImpactAssessment,
  ImpactFacts,
  ImpactSummary,
  msg,
  procedureImpactTargets,
  ProcedureTargetRole,
  summarizeImpacts,
  workflowFamilyKey,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ContextWorkflow, ImpactContext, ImpactContextService } from './impact-context.service';

/** Un lot plus gros se lit mal et se décide encore moins bien. */
export const MAX_STUDY = 200;

export interface WorkflowRef {
  id: string;
  name: string;
  env: string | null;
  instanceName: string;
}

export interface WorkflowImpact extends ImpactAssessment {
  workflow: WorkflowRef & { active: boolean; url: string; platform: 'n8n' | 'make' };
  facts: ImpactFacts;
  callers: WorkflowRef[];
  callees: WorkflowRef[];
  /** URL servies (webhook, formulaire, chat) ou nature de la porte (planifié, Telegram…). */
  entryPoints: Array<{ kind: string; label: string }>;
  resources: Array<{ key: string; provider: string; label: string; mapped: boolean }>;
  lastExecutionAt: string | null;
  /** Make : appels, portes et ressources ne se lisent pas encore dans un blueprint. */
  partial: boolean;
}

export interface ImpactStudy {
  items: WorkflowImpact[];
  summary: ImpactSummary;
  windowDays: number;
}

export interface ProcedureImpactTargetView {
  familyKey: string;
  familyName: string;
  env: string;
  role: ProcedureTargetRole;
  stepPositions: number[];
  /** Absent : aucun exemplaire dans cet env (une copie le créera, ou rien à étudier). */
  impact: WorkflowImpact | null;
  note?: string;
}

export interface ProcedureImpactStudy {
  procedure: { id: string; name: string };
  hop: { source: string; target: string } | null;
  targets: ProcedureImpactTargetView[];
  summary: ImpactSummary;
  windowDays: number;
}

/**
 * Étude d'impact : ce qu'engage une modification d'un workflow, d'un lot, ou le
 * rejeu d'une procédure. Lecture seule, sur le miroir et l'historique de la
 * plateforme — rien n'est demandé à n8n, si bien qu'étudier un lot de cent
 * workflows ne coûte aucun appel et se rejoue à volonté.
 */
@Injectable()
export class ImpactStudyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: ImpactContextService,
  ) {}

  async studyWorkflows(ids: string[]): Promise<ImpactStudy> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) throw new BadRequestException(msg('impact.workflowNotFound'));
    if (unique.length > MAX_STUDY) throw new BadRequestException(msg('impact.tooMany', { max: MAX_STUDY }));
    const context = await this.context.load();
    const items = unique.map((id) => {
      const workflow = context.byId.get(id);
      if (!workflow) throw new NotFoundException(msg('impact.workflowNotFound'));
      return this.assess(workflow, context);
    });
    return { items, summary: this.summarize(items), windowDays: 30 };
  }

  /**
   * L'impact d'un rejeu, avant le premier clic : chaque exemplaire que la procédure
   * écrira, fera tourner ou lira, envs décalés exactement comme au rejeu.
   */
  async studyProcedure(
    id: string,
    hop?: { source?: string; target?: string },
  ): Promise<ProcedureImpactStudy> {
    const procedure = await this.prisma.releaseProcedure.findUnique({
      where: { id },
      include: { steps: { orderBy: { position: 'asc' } } },
    });
    if (!procedure) throw new NotFoundException(msg('impact.procedureNotFound'));
    const recorded =
      procedure.sourceEnv && procedure.targetEnv
        ? { source: procedure.sourceEnv, target: procedure.targetEnv }
        : null;
    const replay = hop?.source && hop.target ? { source: hop.source, target: hop.target } : null;
    const targets = procedureImpactTargets(
      procedure.steps.map((step) => ({
        id: step.id,
        kind: step.kind as 'auto' | 'manual',
        action: step.action as never,
        familyKey: step.familyKey,
        familyName: step.familyName,
        sourceEnv: step.sourceEnv,
        targetEnv: step.targetEnv,
      })),
      recorded,
      replay,
    );

    const context = await this.context.load();
    const envIds = context.envs.map((env) => env.id);
    const positions = new Map(procedure.steps.map((step) => [step.id, step.position + 1]));
    const views = targets.map((target): ProcedureImpactTargetView => {
      // Comme le rejeu (`/release-procedures/resolve`) : l'exemplaire vivant de la famille dans cet env.
      const exemplar = context.workflows.find(
        (workflow) =>
          !workflow.archived &&
          workflow.env === target.env &&
          workflowFamilyKey(workflow.name, envIds) === target.familyKey,
      );
      return {
        familyKey: target.familyKey,
        familyName: target.familyName,
        env: target.env,
        role: target.role,
        stepPositions: target.stepIds.map((stepId) => positions.get(stepId) ?? 0),
        impact: exemplar ? this.assess(exemplar, context) : null,
        ...(exemplar
          ? {}
          : { note: msg('impact.noExemplar', { env: target.env.toUpperCase(), role: target.role }) }),
      };
    });
    const studied = views.map((view) => view.impact).filter((item): item is WorkflowImpact => item !== null);
    return {
      procedure: { id: procedure.id, name: procedure.name },
      hop: replay ?? recorded,
      targets: views,
      summary: this.summarize(studied),
      windowDays: 30,
    };
  }

  private summarize(items: WorkflowImpact[]): ImpactSummary {
    return summarizeImpacts(
      items.map((item) => ({
        id: item.workflow.id,
        level: item.level,
        executions30d: item.facts.executions30d,
        callerIds: item.callers.map((caller) => caller.id),
        resourceKeys: item.resources.map((resource) => resource.key),
      })),
    );
  }

  private assess(workflow: ContextWorkflow, context: ImpactContext): WorkflowImpact {
    const ref = (target: ContextWorkflow): WorkflowRef => ({
      id: target.id,
      name: target.name,
      env: target.env,
      instanceName: target.instanceName,
    });
    const refs = (ids: Set<string> | undefined) =>
      [...(ids ?? [])]
        .map((id) => context.byId.get(id))
        .filter((target): target is ContextWorkflow => !!target && !target.archived)
        .map(ref)
        .sort((a, b) => a.name.localeCompare(b.name));
    const callers = refs(context.callersOf.get(workflow.id));
    const callees = refs(context.calleesOf.get(workflow.id));
    const executions = context.executions.get(`${workflow.instanceId}/${workflow.externalId}`);
    const entryPoints = context.entryPoints(workflow);
    const publicEntries = entryPoints.filter((entry) => entry.segment);

    const resources = new Map<string, WorkflowImpact['resources'][number]>();
    for (const resource of context.resources(workflow)) {
      if (resources.has(resource.key)) continue;
      resources.set(resource.key, {
        key: resource.key,
        provider: resource.provider,
        label: resource.label ?? resource.key,
        // Une API n'a pas de mapping d'env : elle ne compte jamais comme « non mappée ».
        mapped: resource.provider === 'http' || context.isMapped(resource.key),
      });
    }
    const tests = context.testsOf.get(workflow.id) ?? { total: 0, red: 0 };

    const facts: ImpactFacts = {
      active: workflow.active,
      monitoredEnv: context.monitored(workflow.env),
      callers: callers.length,
      executions30d: executions?.total ?? 0,
      failures30d: executions?.failed ?? 0,
      publicEntryPoints: publicEntries.length,
      monitors: context.monitors.get(workflow.id) ?? 0,
      openErrors: context.openErrors.get(workflow.id) ?? 0,
      unmappedResources: [...resources.values()].filter((resource) => !resource.mapped).length,
      testCases: tests.total,
      redTests: tests.red,
      locked: context.locked.has(workflow.id),
    };
    return {
      ...assessImpact(facts),
      workflow: { ...ref(workflow), active: workflow.active, url: workflow.url, platform: workflow.platform },
      facts,
      callers,
      callees,
      entryPoints: entryPoints.map((entry) => ({
        kind: entry.kind,
        label: entry.segment ? `/${entry.segment}/${entry.path}` : (entry.label ?? entry.kind),
      })),
      resources: [...resources.values()],
      lastExecutionAt: executions?.lastAt?.toISOString() ?? null,
      partial: workflow.platform !== 'n8n',
    };
  }
}
