import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  EVENTS,
  ErrorGroupNotableEvent,
  categorizeError,
  currentLocale,
  errorSignature,
  msg,
} from '@nwm/core';
import { ErrorGroup, ExecutionError, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EventBusService } from '../../infra/events/event-bus.service';
import { PlatformLocale } from '../../infra/i18n/platform-locale';

/** Statuts d'un groupe. `ignored` = erreur connue et acceptée : plus de réouverture auto. */
export type ErrorGroupStatus = 'open' | 'resolved' | 'ignored';

/** Lot maximum traité par un appel de rattrapage (`regroup`). */
const REGROUP_BATCH = 2000;

export interface RegroupResult {
  processed: number;
  groups: number;
  remaining: number;
}

export interface GroupActionInput {
  note?: string;
  author?: string;
}

/**
 * Regroupe les erreurs en « problèmes » par signature (workflow + nœud + forme du
 * message). Un groupe traité qui refrappe se rouvre seul et journalise la rechute.
 */
@Injectable()
export class ErrorGroupService {
  private readonly logger = new Logger(ErrorGroupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly platformLocale: PlatformLocale,
  ) {}

  /** Rattache une erreur à son groupe (l'en détache si sa signature a changé, détail arrivé après coup). */
  async assign(row: ExecutionError): Promise<ErrorGroup> {
    const { key, pattern } = errorSignature({
      externalWorkflowId: row.externalWorkflowId,
      failedNode: row.failedNode,
      message: row.message,
    });

    // findUnique + create plutôt qu'upsert : il faut savoir si le groupe vient de
    // naître — c'est l'événement « nouveau problème » que le module notifier écoute.
    const where = { instanceId_signature: { instanceId: row.instanceId, signature: key } };
    let group = await this.prisma.errorGroup.findUnique({ where });
    if (!group) {
      const data = {
        instanceId: row.instanceId,
        signature: key,
        externalWorkflowId: row.externalWorkflowId,
        workflowId: row.workflowId,
        workflowName: row.workflowName,
        failedNode: row.failedNode,
        failedNodeType: row.failedNodeType,
        pattern,
        sample: row.message,
        category: categorizeError(row.message),
        occurrences: 0,
        firstSeenAt: row.startedAt,
        lastSeenAt: row.startedAt,
      };
      // Course possible entre deux ingestions : le perdant relit le groupe du gagnant.
      group = await this.prisma.errorGroup
        .create({ data })
        .catch(() => this.prisma.errorGroup.findUniqueOrThrow({ where }));
    }

    // Même groupe qu'avant : rien à recompter, mais l'annonce peut être due (le
    // détail vient d'arriver sans changer la signature).
    if (row.groupId === group.id) return this.announce(group, row, false);

    const previousGroupId = row.groupId;
    await this.prisma.executionError.update({
      where: { id: row.id },
      data: { groupId: group.id },
    });
    if (previousGroupId) await this.recount(previousGroupId);

    const refreshed = await this.recount(group.id, {
      workflowName: row.workflowName,
      workflowId: row.workflowId,
      // Le dernier message réel illustre le pattern ; on ne garde que le plus récent.
      // La catégorie le suit : c'est du message brut qu'elle se déduit.
      ...(row.message && row.startedAt >= group.lastSeenAt
        ? { sample: row.message, category: categorizeError(row.message) }
        : {}),
    });
    const current = refreshed ?? group;
    const regressed = await this.handleRegression(current, row);
    // Une rechute est déjà une alerte à elle seule : pas de récurrence en plus.
    return regressed ?? this.announce(current, row, true);
  }

  /** Rattrapage : range les erreurs pas encore groupées (historique importé, lignes d'avant le regroupement). */
  async regroup(instanceId?: string, limit = 500): Promise<RegroupResult> {
    const where: Prisma.ExecutionErrorWhereInput = {
      groupId: null,
      ...(instanceId ? { instanceId } : {}),
    };
    const rows = await this.prisma.executionError.findMany({
      where,
      orderBy: { startedAt: 'asc' },
      take: Math.min(Math.max(limit, 1), REGROUP_BATCH),
    });

    const groups = new Set<string>();
    for (const row of rows) {
      try {
        const group = await this.assign(row);
        groups.add(group.id);
      } catch (error) {
        this.logger.warn(`Grouping failed for error ${row.id}: ${(error as Error).message}`);
      }
    }
    return {
      processed: rows.length,
      groups: groups.size,
      remaining: await this.prisma.executionError.count({ where }),
    };
  }

  /** Rattrapage pour l'historique d'avant la catégorie : les nouvelles occurrences se tiennent à jour seules. */
  async recategorize(instanceId?: string): Promise<{ processed: number; changed: number }> {
    const groups = await this.prisma.errorGroup.findMany({
      where: instanceId ? { instanceId } : {},
      select: { id: true, category: true, sample: true, pattern: true },
    });
    let changed = 0;
    for (const group of groups) {
      const category = categorizeError(group.sample ?? group.pattern);
      if (category === group.category) continue;
      await this.prisma.errorGroup.update({ where: { id: group.id }, data: { category } });
      changed++;
    }
    return { processed: groups.length, changed };
  }

  /** « C'est traité » : le groupe sort des ouverts et son journal enregistre la date. */
  async resolve(id: string, input: GroupActionInput = {}): Promise<ErrorGroup> {
    const group = await this.find(id);
    return this.transition(group, 'resolved', 'resolved', input, {
      resolvedAt: new Date(),
      resolvedBy: input.author ?? null,
      resolutionNote: input.note ?? null,
    });
  }

  /** Réouverture manuelle (« en fait non, ce n'est pas réglé »). */
  async reopen(id: string, input: GroupActionInput = {}): Promise<ErrorGroup> {
    const group = await this.find(id);
    return this.transition(group, 'open', 'reopened', input, { reopenedAt: new Date() });
  }

  /** « Erreur connue, on l'accepte » : plus de réouverture automatique. */
  async ignore(id: string, input: GroupActionInput = {}): Promise<ErrorGroup> {
    const group = await this.find(id);
    return this.transition(group, 'ignored', 'ignored', input, {});
  }

  /** Commentaire libre déposé dans le journal, sans changer le statut. */
  async comment(id: string, input: GroupActionInput): Promise<ErrorGroup> {
    const group = await this.find(id);
    await this.log(group, 'note', input);
    return group;
  }

  /**
   * Recalcule les compteurs depuis les occurrences réellement présentes.
   * C'est la seule source de vérité : la purge et les changements de signature
   * déplacent des lignes, un compteur incrémenté dériverait.
   */
  async recount(
    groupId: string,
    extra: Prisma.ErrorGroupUncheckedUpdateInput = {},
  ): Promise<ErrorGroup | null> {
    const stats = await this.prisma.executionError.aggregate({
      where: { groupId },
      _count: { _all: true },
      _min: { startedAt: true },
      _max: { startedAt: true },
    });
    const total = stats._count._all;
    if (total === 0) {
      // Plus aucune occurrence (purge de l'historique) : le groupe n'a plus d'objet.
      await this.prisma.errorGroup.delete({ where: { id: groupId } }).catch(() => undefined);
      return null;
    }
    return this.prisma.errorGroup.update({
      where: { id: groupId },
      data: {
        ...extra,
        occurrences: total,
        firstSeenAt: stats._min.startedAt ?? undefined,
        lastSeenAt: stats._max.startedAt ?? undefined,
      },
    });
  }

  private async find(id: string): Promise<ErrorGroup> {
    const group = await this.prisma.errorGroup.findUnique({ where: { id } });
    if (!group) throw new NotFoundException(msg('ops.errorGroupNotFound', { id }));
    return group;
  }

  private async transition(
    group: ErrorGroup,
    status: ErrorGroupStatus,
    type: string,
    input: GroupActionInput,
    data: Prisma.ErrorGroupUpdateInput,
  ): Promise<ErrorGroup> {
    const updated = await this.prisma.errorGroup.update({
      where: { id: group.id },
      data: { ...data, status },
    });
    await this.log(updated, type, input);
    return updated;
  }

  /**
   * Annonce d'un groupe, et rappel de ses occurrences suivantes.
   *
   * Tant que le détail de l'exécution n'est pas retombé, la signature est provisoire
   * (« (sans détail) ») : alerter dessus enverrait un « nouveau problème » par
   * exécution, pour un groupe dissous dès que le message arrive. Une fois le groupe
   * annoncé, les occurrences partent en `recurred` — le notifier les regroupe.
   */
  private async announce(
    group: ErrorGroup,
    row: ExecutionError,
    isNewOccurrence: boolean,
  ): Promise<ErrorGroup> {
    if (group.notifiedAt) {
      if (isNewOccurrence && group.status === 'open') {
        this.emitNotable(EVENTS.errorGroupRecurred, group, row);
      }
      return group;
    }
    if (row.detailState === 'pending') return group;

    const notified = await this.prisma.errorGroup.update({
      where: { id: group.id },
      data: { notifiedAt: new Date() },
    });
    this.emitNotable(EVENTS.errorGroupOpened, notified, row);
    return notified;
  }

  /**
   * Rechute : une erreur postérieure à la résolution rouvre le groupe et trace le cycle.
   * Renvoie null quand il n'y a pas rechute — l'appelant enchaîne alors sur l'annonce.
   */
  private async handleRegression(group: ErrorGroup, row: ExecutionError): Promise<ErrorGroup | null> {
    if (group.status !== 'resolved') return null;
    // Un backfill peut importer des occurrences ANTÉRIEURES à la résolution :
    // elles ne remettent pas le problème en cause.
    if (group.resolvedAt && row.startedAt <= group.resolvedAt) return null;

    const reopened = await this.prisma.errorGroup.update({
      where: { id: group.id },
      data: { status: 'open', reopenedAt: new Date(), regressions: { increment: 1 } },
    });
    await this.log(reopened, 'regression', {
      // Le journal du groupe est relu par toute l'équipe : langue de la plateforme.
      note: this.platformLocale.run(() =>
        msg('ops.regressionNote', {
          at: row.startedAt.toLocaleString(currentLocale()),
          executionId: row.executionId,
          resolved: group.resolvedAt !== null,
          resolvedAt: group.resolvedAt?.toLocaleString(currentLocale()) ?? '',
        }),
      ),
    });
    this.emitNotable(EVENTS.errorGroupRegressed, reopened, row);
    return reopened;
  }

  /** Nouveau problème ou rechute : l'événement que le module notifier transforme en alerte. */
  private emitNotable(
    name:
      typeof EVENTS.errorGroupOpened | typeof EVENTS.errorGroupRegressed | typeof EVENTS.errorGroupRecurred,
    group: ErrorGroup,
    row: ExecutionError,
  ): void {
    const event: ErrorGroupNotableEvent = {
      groupId: group.id,
      instanceId: group.instanceId,
      workflowName: group.workflowName,
      failedNode: group.failedNode,
      pattern: group.pattern,
      category: group.category,
      occurredAt: row.startedAt.toISOString(),
      regressions: group.regressions,
      occurrences: group.occurrences,
    };
    this.eventBus.emit(name, event);
  }

  private async log(group: ErrorGroup, type: string, input: GroupActionInput): Promise<void> {
    await this.prisma.errorGroupEvent.create({
      data: {
        groupId: group.id,
        type,
        note: input.note?.trim() || null,
        author: input.author ?? null,
        occurrences: group.occurrences,
      },
    });
  }
}
