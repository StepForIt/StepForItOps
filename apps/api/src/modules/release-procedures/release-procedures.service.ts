import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  captureGesture,
  detectWorkflowEnv,
  GestureInput,
  hopStep,
  insertPosition,
  MacroAction,
  manualGesture,
  msg,
  rebaseSteps,
  reorderSteps,
  stepLabel,
  workflowFamilyKey,
  workflowFamilyName,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';

export interface CaptureInput {
  method: string;
  path: string;
  body?: unknown;
}

export interface DuplicateInput {
  sourceEnv: string;
  targetEnv: string;
  name?: string;
}

/** `frozen` : étapes figées en tête par un rejeu en cours (le rejeu vit dans le navigateur). */
export interface InsertInput {
  position?: number;
  frozen?: number;
  note?: string | null;
}

export interface StepPatch {
  label?: string;
  note?: string | null;
}

/** Une note vide n'est pas une note. */
const cleanNote = (note: string | null | undefined): string | null => note?.trim() || null;

export interface ProcedureStepRow {
  id: string;
  position: number;
  kind: 'auto' | 'manual';
  action: MacroAction | null;
  familyKey: string | null;
  familyName: string | null;
  sourceEnv: string | null;
  targetEnv: string | null;
  options: Record<string, boolean> | null;
  label: string;
  note: string | null;
}

export interface ProcedureRow {
  id: string;
  name: string;
  status: 'recording' | 'ready';
  recordedBy: string | null;
  sourceEnv: string | null;
  targetEnv: string | null;
  steps: ProcedureStepRow[];
  createdAt: Date;
  updatedAt: Date;
}

const WITH_STEPS = { steps: { orderBy: { position: 'asc' as const } } };

type ProcedureRecord = Prisma.ReleaseProcedureGetPayload<{ include: typeof WITH_STEPS }>;
type StepRecord = ProcedureRecord['steps'][number];

function toStep(step: StepRecord): ProcedureStepRow {
  return {
    id: step.id,
    position: step.position,
    kind: step.kind as ProcedureStepRow['kind'],
    action: step.action as MacroAction | null,
    familyKey: step.familyKey,
    familyName: step.familyName,
    sourceEnv: step.sourceEnv,
    targetEnv: step.targetEnv,
    options: (step.options as Record<string, boolean> | null) ?? null,
    label: step.label,
    note: step.note,
  };
}

function toRow(procedure: ProcedureRecord): ProcedureRow {
  return {
    id: procedure.id,
    name: procedure.name,
    status: procedure.status as ProcedureRow['status'],
    recordedBy: procedure.recordedBy,
    sourceEnv: procedure.sourceEnv,
    targetEnv: procedure.targetEnv,
    createdAt: procedure.createdAt,
    updatedAt: procedure.updatedAt,
    steps: procedure.steps.map(toStep),
  };
}

/**
 * Procédures de mise en ligne, enregistrées comme une macro : le navigateur
 * signale chaque appel d'API réussi pendant l'enregistrement, on n'en garde que
 * les gestes rejouables (`captureGesture`), rangés par workflow métier et par
 * env pour être rejoués un cran plus loin dans la chaîne.
 */
@Injectable()
export class ReleaseProceduresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
  ) {}

  async list(): Promise<ProcedureRow[]> {
    const rows = await this.prisma.releaseProcedure.findMany({
      include: WITH_STEPS,
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map(toRow);
  }

  async get(id: string): Promise<ProcedureRow> {
    const procedure = await this.prisma.releaseProcedure.findUnique({ where: { id }, include: WITH_STEPS });
    if (!procedure) throw new NotFoundException(msg('release.procedureNotFound'));
    return toRow(procedure);
  }

  async active(user: string): Promise<ProcedureRow | null> {
    const procedure = await this.prisma.releaseProcedure.findFirst({
      where: { status: 'recording', recordedBy: user },
      include: WITH_STEPS,
      orderBy: { createdAt: 'desc' },
    });
    return procedure ? toRow(procedure) : null;
  }

  /** Un enregistrement par personne : en démarrer un clôt celui qui tournait encore. */
  async start(name: string, user: string): Promise<ProcedureRow> {
    const trimmed = name?.trim();
    if (!trimmed) throw new BadRequestException(msg('release.nameRequired'));
    await this.prisma.releaseProcedure.updateMany({
      where: { status: 'recording', recordedBy: user },
      data: { status: 'ready' },
    });
    const procedure = await this.prisma.releaseProcedure.create({
      data: { name: trimmed, recordedBy: user },
      include: WITH_STEPS,
    });
    return toRow(procedure);
  }

  async stop(id: string): Promise<ProcedureRow> {
    await this.get(id);
    const procedure = await this.prisma.releaseProcedure.update({
      where: { id },
      data: { status: 'ready' },
      include: WITH_STEPS,
    });
    return toRow(procedure);
  }

  async rename(id: string, name: string): Promise<ProcedureRow> {
    if (!name?.trim()) throw new BadRequestException(msg('release.nameRequired'));
    await this.get(id);
    const procedure = await this.prisma.releaseProcedure.update({
      where: { id },
      data: { name: name.trim() },
      include: WITH_STEPS,
    });
    return toRow(procedure);
  }

  async remove(id: string): Promise<{ id: string }> {
    await this.get(id);
    await this.prisma.releaseProcedure.delete({ where: { id } });
    return { id };
  }

  /**
   * Copie la procédure sur un autre saut (dev → preprod enregistré, preprod → prod copié) :
   * une procédure à part entière, sans lien avec l'originale, qui se rejoue sur son propre saut.
   */
  async duplicate(id: string, input: DuplicateInput, user: string): Promise<ProcedureRow> {
    const procedure = await this.get(id);
    if (procedure.status === 'recording') throw new BadRequestException(msg('release.recordingInProgress'));
    if (!procedure.sourceEnv || !procedure.targetEnv) {
      throw new BadRequestException(msg('release.noHopRecorded'));
    }
    const to = { source: input.sourceEnv, target: input.targetEnv };
    if (!to.source || !to.target || to.source === to.target) {
      throw new BadRequestException(msg('release.pickTwoEnvs'));
    }
    const envIds = await this.settings.declaredEnvIds();
    const unknown = [to.source, to.target].find((env) => !envIds.includes(env));
    if (unknown) throw new BadRequestException(msg('release.envNotDeclared', { env: unknown.toUpperCase() }));
    const recorded = { source: procedure.sourceEnv, target: procedure.targetEnv };
    if (recorded.source === to.source && recorded.target === to.target) {
      throw new BadRequestException(msg('release.sameHop'));
    }

    const hop = `${to.source.toUpperCase()} → ${to.target.toUpperCase()}`;
    const steps = rebaseSteps(procedure.steps, recorded, to);
    const copy = await this.prisma.releaseProcedure.create({
      data: {
        name: input.name?.trim() || `${procedure.name} (${hop})`,
        status: 'ready',
        recordedBy: user,
        sourceEnv: to.source,
        targetEnv: to.target,
        steps: {
          create: steps.map((step, position) => ({
            position,
            kind: step.kind,
            action: step.action,
            familyKey: step.familyKey,
            familyName: step.familyName,
            sourceEnv: step.sourceEnv,
            targetEnv: step.targetEnv,
            options: step.options ?? Prisma.DbNull,
            label: step.label,
            note: step.note,
          })),
        },
      },
      include: WITH_STEPS,
    });
    return toRow(copy);
  }

  async capture(user: string, input: CaptureInput): Promise<{ captured: boolean; step?: ProcedureStepRow }> {
    const gesture = captureGesture(input.method, input.path, input.body);
    if (!gesture) return { captured: false };
    const procedure = await this.active(user);
    if (!procedure) return { captured: false };
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: gesture.workflowId },
      select: { name: true, tags: true },
    });
    if (!workflow) return { captured: false };

    const envIds = await this.settings.declaredEnvIds();
    const sourceEnv = detectWorkflowEnv(workflow.name, workflow.tags, envIds);
    const familyName = workflowFamilyName(workflow.name, envIds);
    const step = await this.insertStep(procedure.id, procedure.steps.length, {
      kind: 'auto',
      action: gesture.action,
      familyKey: workflowFamilyKey(workflow.name, envIds),
      familyName,
      sourceEnv,
      targetEnv: gesture.targetEnv,
      options: gesture.options,
      label: stepLabel({ action: gesture.action, familyName, targetEnv: gesture.targetEnv, sourceEnv }),
    });
    await this.recordHop(procedure, step);
    return { captured: true, step };
  }

  /** Étape à valider par un humain ; sans position, elle part à la fin — là où en est l'enregistrement. */
  async addManual(id: string, input: InsertInput & { label: string }): Promise<ProcedureStepRow> {
    const label = input.label?.trim();
    if (!label) throw new BadRequestException(msg('release.sayWhatToDo'));
    const procedure = await this.get(id);
    const position = insertPosition(input.position, procedure.steps.length, input.frozen);
    return this.insertStep(id, position, { kind: 'manual', label, note: cleanNote(input.note) });
  }

  /** Un geste rejouable posé à la main : même forme qu'une étape captée (`manualGesture`). */
  async addGesture(id: string, input: InsertInput & GestureInput): Promise<ProcedureStepRow> {
    const result = manualGesture(input, await this.settings.declaredEnvIds());
    if (!result.ok) throw new BadRequestException(result.reason);
    const procedure = await this.get(id);
    const position = insertPosition(input.position, procedure.steps.length, input.frozen);
    const step = await this.insertStep(id, position, { ...result.step, note: cleanNote(input.note) });
    await this.recordHop(procedure, step);
    return step;
  }

  /** La note se pose sur toute étape ; le libellé d'une étape automatique, lui, se déduit du geste. */
  async updateStep(id: string, stepId: string, patch: StepPatch): Promise<ProcedureStepRow> {
    const step = await this.prisma.releaseProcedureStep.findFirst({ where: { id: stepId, procedureId: id } });
    if (!step) throw new NotFoundException(msg('release.stepNotFound'));
    const data: Prisma.ReleaseProcedureStepUpdateInput = {};
    if (patch.label !== undefined) {
      if (step.kind !== 'manual') throw new BadRequestException(msg('release.gestureLabelDerived'));
      const label = patch.label.trim();
      if (!label) throw new BadRequestException(msg('release.sayWhatToDo'));
      data.label = label;
    }
    if (patch.note !== undefined) data.note = cleanNote(patch.note);
    const [updated] = await this.prisma.$transaction([
      this.prisma.releaseProcedureStep.update({ where: { id: stepId }, data }),
      this.prisma.releaseProcedure.update({ where: { id }, data: { updatedAt: new Date() } }),
    ]);
    return toStep(updated);
  }

  /**
   * Refait le geste d'une étape automatique, par les mêmes règles que sa saisie (`manualGesture`).
   * Une étape déjà jouée par un rejeu en cours ne se modifie plus. Si l'étape dit le saut de la
   * procédure — avant ou après la modification —, le saut est relu sur les étapes.
   */
  async updateGesture(
    id: string,
    stepId: string,
    input: GestureInput & { frozen?: number; note?: string | null },
  ): Promise<ProcedureStepRow> {
    const procedure = await this.get(id);
    const index = procedure.steps.findIndex((step) => step.id === stepId);
    if (index === -1) throw new NotFoundException(msg('release.stepNotFound'));
    if (procedure.steps[index].kind !== 'auto') throw new BadRequestException(msg('release.notAGesture'));
    if (index < (input.frozen ?? 0)) throw new BadRequestException(msg('release.frozenSteps'));
    const result = manualGesture(input, await this.settings.declaredEnvIds());
    if (!result.ok) throw new BadRequestException(result.reason);

    const { kind: _kind, ...gesture } = result.step;
    const data: Prisma.ReleaseProcedureStepUpdateInput = { ...gesture };
    if (input.note !== undefined) data.note = cleanNote(input.note);
    const updated = toStep(await this.prisma.releaseProcedureStep.update({ where: { id: stepId }, data }));

    const after = procedure.steps.map((step) => (step.id === stepId ? updated : step));
    const defined = hopStep(procedure.steps)?.id === stepId || hopStep(after)?.id === stepId;
    const hop = hopStep(after);
    await this.prisma.releaseProcedure.update({
      where: { id },
      data: {
        updatedAt: new Date(),
        ...(defined && hop ? { sourceEnv: hop.sourceEnv, targetEnv: hop.targetEnv } : {}),
      },
    });
    return updated;
  }

  /** Réécrit les positions d'après l'ordre complet des étapes (`reorderSteps`). */
  async reorder(id: string, input: { order: string[]; frozen?: number }): Promise<ProcedureRow> {
    const procedure = await this.get(id);
    const result = reorderSteps(
      procedure.steps.map((step) => step.id),
      Array.isArray(input.order) ? input.order : [],
      input.frozen,
    );
    if (!result.ok) throw new BadRequestException(result.reason);
    await this.prisma.$transaction([
      ...result.order.map((stepId, position) =>
        this.prisma.releaseProcedureStep.update({ where: { id: stepId }, data: { position } }),
      ),
      this.prisma.releaseProcedure.update({ where: { id }, data: { updatedAt: new Date() } }),
    ]);
    return this.get(id);
  }

  async removeStep(id: string, stepId: string): Promise<{ id: string }> {
    const step = await this.prisma.releaseProcedureStep.findFirst({ where: { id: stepId, procedureId: id } });
    if (!step) throw new NotFoundException(msg('release.stepNotFound'));
    await this.prisma.$transaction([
      this.prisma.releaseProcedureStep.delete({ where: { id: stepId } }),
      this.prisma.releaseProcedureStep.updateMany({
        where: { procedureId: id, position: { gt: step.position } },
        data: { position: { decrement: 1 } },
      }),
    ]);
    return { id: stepId };
  }

  /** L'exemplaire d'un workflow métier dans un env, pour rejouer un geste qui ne vise qu'un workflow. */
  async resolve(familyKey: string, env: string): Promise<{ workflowId: string; active: boolean }> {
    const envIds = await this.settings.declaredEnvIds();
    const candidates = await this.prisma.workflow.findMany({
      where: { archivedUpstream: false, missingUpstreamAt: null },
      select: { id: true, name: true, tags: true, active: true },
    });
    const match = candidates.find(
      (workflow) =>
        workflowFamilyKey(workflow.name, envIds) === familyKey &&
        detectWorkflowEnv(workflow.name, workflow.tags, envIds) === env,
    );
    if (!match) throw new NotFoundException(msg('release.noExemplar', { env: env.toUpperCase() }));
    return { workflowId: match.id, active: match.active };
  }

  /**
   * Le premier geste qui change d'env dit quel saut a été enregistré : c'est lui que le rejeu décale.
   * Seul un geste qui fait exister le workflow ailleurs le dit — déclarer ou rebrancher le laissent sur place.
   */
  private async recordHop(procedure: ProcedureRow, step: ProcedureStepRow): Promise<void> {
    if (procedure.targetEnv || !step.sourceEnv || !step.targetEnv) return;
    if (step.action !== 'promote' && step.action !== 'duplicate') return;
    await this.prisma.releaseProcedure.update({
      where: { id: procedure.id },
      data: { sourceEnv: step.sourceEnv, targetEnv: step.targetEnv },
    });
  }

  private async insertStep(
    procedureId: string,
    position: number,
    data: Omit<Prisma.ReleaseProcedureStepUncheckedCreateInput, 'procedureId' | 'position'>,
  ): Promise<ProcedureStepRow> {
    const [, created] = await this.prisma.$transaction([
      this.prisma.releaseProcedureStep.updateMany({
        where: { procedureId, position: { gte: position } },
        data: { position: { increment: 1 } },
      }),
      this.prisma.releaseProcedureStep.create({ data: { ...data, procedureId, position } }),
      this.prisma.releaseProcedure.update({ where: { id: procedureId }, data: { updatedAt: new Date() } }),
    ]);
    return toStep(created);
  }
}
