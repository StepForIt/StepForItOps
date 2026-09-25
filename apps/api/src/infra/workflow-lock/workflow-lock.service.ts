import { HttpException, Injectable } from '@nestjs/common';
import { LockedWorkflow, WORKFLOW_LOCKED_CODE, lockRefusalMessage, lockVerdict } from '@nwm/core';
import { WorkflowLock, WorkflowLockOverride } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { currentLockContext } from './lock-context';

/** Absent de `HttpStatus` en Nest 10. */
const HTTP_LOCKED = 423;

/** 423 : la ressource est verrouillée. Le corps nomme les exemplaires, la console en fait sa modale. */
export class WorkflowLockedException extends HttpException {
  constructor(readonly locked: LockedWorkflow[]) {
    super(
      {
        statusCode: HTTP_LOCKED,
        code: WORKFLOW_LOCKED_CODE,
        message: lockRefusalMessage(locked),
        locked,
      },
      HTTP_LOCKED,
    );
  }
}

export interface WorkflowLockDetail {
  lock: WorkflowLock | null;
  overrides: WorkflowLockOverride[];
}

/**
 * Le verrou d'un exemplaire, et le garde que TOUTE écriture de la plateforme vers
 * n8n ou Make appelle avant de partir. Un seul garde, dans l'infra, pour que les
 * modules le partagent sans s'importer.
 */
@Injectable()
export class WorkflowLockService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<WorkflowLock[]> {
    return this.prisma.workflowLock.findMany({ orderBy: { lockedAt: 'desc' } });
  }

  async detail(workflowId: string): Promise<WorkflowLockDetail> {
    const [lock, overrides] = await Promise.all([
      this.prisma.workflowLock.findUnique({ where: { workflowId } }),
      this.prisma.workflowLockOverride.findMany({
        where: { workflowId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    return { lock, overrides };
  }

  lock(workflowId: string, lockedBy?: string, note?: string): Promise<WorkflowLock> {
    const data = { lockedBy: lockedBy ?? null, note: note?.trim() || null };
    return this.prisma.workflowLock.upsert({
      where: { workflowId },
      create: { workflowId, ...data },
      update: data,
    });
  }

  async unlock(workflowId: string): Promise<void> {
    await this.prisma.workflowLock.deleteMany({ where: { workflowId } });
  }

  /** Les exemplaires verrouillés parmi ceux-là, nommés. */
  async lockedAmong(workflowIds: string[]): Promise<LockedWorkflow[]> {
    const ids = [...new Set(workflowIds.filter(Boolean))];
    if (ids.length === 0) return [];
    const locks = await this.prisma.workflowLock.findMany({
      where: { workflowId: { in: ids } },
      select: { workflowId: true, lockedBy: true, workflow: { select: { name: true } } },
    });
    return locks.map((lock) => ({ id: lock.workflowId, name: lock.workflow.name, lockedBy: lock.lockedBy }));
  }

  async isLocked(workflowId: string): Promise<boolean> {
    return (await this.prisma.workflowLock.count({ where: { workflowId } })) > 0;
  }

  /**
   * Refuse (423) si un de ces exemplaires est verrouillé et que la requête ne le
   * lève pas nommément ; journalise chaque verrou levé. À appeler AVANT la
   * première écriture du geste : un refus à mi-chemin laisserait un état partiel.
   */
  async assertWritable(workflowIds: string | string[]): Promise<void> {
    const locked = await this.lockedAmong(Array.isArray(workflowIds) ? workflowIds : [workflowIds]);
    if (locked.length === 0) return;
    const context = currentLockContext();
    const verdict = lockVerdict(locked, context?.override ?? null);
    if (verdict.blocking.length > 0) throw new WorkflowLockedException(verdict.blocking);
    const journaled = context?.journaled ?? new Set<string>();
    if (context) context.journaled = journaled;
    const fresh = verdict.overridden.filter((workflow) => !journaled.has(workflow.id));
    fresh.forEach((workflow) => journaled.add(workflow.id));
    if (fresh.length === 0) return;
    await this.prisma.workflowLockOverride.createMany({
      data: fresh.map((workflow) => ({
        workflowId: workflow.id,
        action: context?.action ?? 'hors requête',
        reason: context?.override?.reason ?? '',
        author: context?.author ?? null,
      })),
    });
  }

  /**
   * Pour une écriture ACCESSOIRE qu'un geste peut sauter sans échouer (renommage
   * de la source d'une promotion, publication d'un appelé) : vrai si elle peut
   * partir — non verrouillé, ou levé et journalisé.
   */
  async canWrite(workflowId: string): Promise<boolean> {
    try {
      await this.assertWritable(workflowId);
      return true;
    } catch (error) {
      if (error instanceof WorkflowLockedException) return false;
      throw error;
    }
  }
}
