import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  buildProcedureBundle,
  ImportConflict,
  msg,
  parseProcedureBundle,
  planProcedureImport,
  ProcedureBundle,
  ProcedureImportRow,
  workflowFamilyKey,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';

export interface ProcedureImportInput {
  bundle: unknown;
  onConflict?: ImportConflict;
  dryRun?: boolean;
}

export interface ProcedureImportReport {
  dryRun: boolean;
  rows: ProcedureImportRow[];
  created: number;
  replaced: number;
  skipped: number;
}

const CONFLICTS: ImportConflict[] = ['skip', 'replace', 'duplicate'];

/**
 * Export et import de procédures, une, plusieurs ou toutes : d'une plateforme à
 * l'autre, ou pour en garder une copie hors de la base. Le fichier ne porte que ce
 * qui se rejoue (étapes, saut enregistré) — jamais d'id, d'auteur ni d'état
 * d'enregistrement : une procédure importée arrive prête, au nom de qui l'importe.
 */
@Injectable()
export class ReleaseProceduresTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
  ) {}

  /** Sans `ids` : toutes les procédures prêtes. Une procédure encore en enregistrement n'est pas finie. */
  async export(ids?: string[]): Promise<ProcedureBundle> {
    const rows = await this.prisma.releaseProcedure.findMany({
      where: ids?.length ? { id: { in: ids } } : { status: 'ready' },
      include: { steps: { orderBy: { position: 'asc' } } },
      orderBy: { name: 'asc' },
    });
    if (ids?.length && rows.some((row) => row.status === 'recording')) {
      throw new BadRequestException(msg('release.exportRecording'));
    }
    if (rows.length === 0) throw new BadRequestException(msg('release.exportNothing'));
    return buildProcedureBundle(
      rows.map((row) => ({
        name: row.name,
        sourceEnv: row.sourceEnv,
        targetEnv: row.targetEnv,
        steps: row.steps.map((step) => ({
          kind: step.kind as 'auto' | 'manual',
          action: step.action as never,
          familyKey: step.familyKey,
          familyName: step.familyName,
          sourceEnv: step.sourceEnv,
          targetEnv: step.targetEnv,
          options: (step.options as Record<string, boolean> | null) ?? null,
          label: step.label,
          note: step.note,
        })),
      })),
    );
  }

  /**
   * Le dry-run rend le plan sans rien écrire ; l'application rejoue le MÊME plan.
   * Remplacer une procédure, c'est la recréer : ses étapes changent toutes, et une
   * procédure homonyme en cours d'enregistrement n'est jamais remplacée.
   */
  async import(input: ProcedureImportInput, user: string): Promise<ProcedureImportReport> {
    const parsed = parseProcedureBundle(input.bundle);
    if (!parsed.ok) throw new BadRequestException(parsed.reason);
    const onConflict = CONFLICTS.includes(input.onConflict as ImportConflict)
      ? (input.onConflict as ImportConflict)
      : 'skip';

    const envIds = await this.settings.declaredEnvIds();
    const [existing, workflows] = await Promise.all([
      this.prisma.releaseProcedure.findMany({ select: { id: true, name: true, status: true } }),
      this.prisma.workflow.findMany({
        where: { archivedUpstream: false, missingUpstreamAt: null },
        select: { name: true },
      }),
    ]);
    const families = new Set(workflows.map((workflow) => workflowFamilyKey(workflow.name, envIds)));
    const rows = planProcedureImport(
      parsed.bundle,
      existing.map((procedure) => procedure.name),
      envIds,
      families,
      onConflict,
    ).map((row) => {
      const recording = existing.some((p) => p.name === row.name && p.status === 'recording');
      return row.outcome === 'replace' && recording ? { ...row, outcome: 'skip' as const } : row;
    });

    const report: ProcedureImportReport = {
      dryRun: Boolean(input.dryRun),
      rows,
      created: rows.filter((row) => row.outcome === 'create').length,
      replaced: rows.filter((row) => row.outcome === 'replace').length,
      skipped: rows.filter((row) => row.outcome === 'skip').length,
    };
    if (input.dryRun) return report;

    await this.prisma.$transaction(async (tx) => {
      for (const [index, row] of rows.entries()) {
        if (row.outcome === 'skip') continue;
        const procedure = parsed.bundle.procedures[index];
        if (row.outcome === 'replace') {
          await tx.releaseProcedure.deleteMany({ where: { name: row.name, status: 'ready' } });
        }
        await tx.releaseProcedure.create({
          data: {
            name: row.importName,
            status: 'ready',
            recordedBy: user,
            sourceEnv: procedure.sourceEnv,
            targetEnv: procedure.targetEnv,
            steps: {
              create: procedure.steps.map((step, position) => ({
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
        });
      }
    });
    return report;
  }
}
