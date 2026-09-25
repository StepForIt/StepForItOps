import { Injectable, Logger } from '@nestjs/common';
import { AssistantLesson as LessonRow } from '@prisma/client';
import {
  AssistantLesson,
  LessonOrigin,
  MAX_RECALLED,
  keywordsOf,
  recallLessons,
  saysTheSame,
  statusAfterOccurrence,
  trimLesson,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** Ce qu'une distillation produit, avant de savoir si c'est neuf. */
export interface LessonDraft {
  content: string;
  nodeTypes: string[];
  origin: LessonOrigin;
  originWorkflowId?: string | null;
  /** Un humain a répondu : la leçon est active tout de suite. */
  confirmedBy?: string | null;
}

function toDomain(row: LessonRow): AssistantLesson {
  return {
    id: row.id,
    content: row.content,
    nodeTypes: row.nodeTypes,
    keywords: row.keywords,
    status: row.status as AssistantLesson['status'],
    occurrences: row.occurrences,
    recalls: row.recalls,
    origin: row.origin as LessonOrigin,
  };
}

/**
 * Le corpus de leçons : y écrire, et en tirer les quelques-unes qui valent pour
 * le tour en cours.
 *
 * Tout l'enjeu est de ne PAS empiler. Une leçon qui redit une leçon existante la
 * réécrit et incrémente son compteur — c'est ce compteur, et non l'accumulation,
 * qui fait passer une candidate en règle. Sans ça le corpus deviendrait le
 * journal de tout ce qui s'est mal passé, où plus personne ne distingue la règle
 * de l'anecdote.
 */
@Injectable()
export class LessonStoreService {
  private readonly logger = new Logger(LessonStoreService.name);

  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<LessonRow[]> {
    return this.prisma.assistantLesson.findMany({ orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }] });
  }

  /**
   * Range une leçon : réécrit celle qui disait déjà la même chose, ou en crée une.
   *
   * L'appariement se fait en mémoire sur le corpus entier. C'est assumé : à
   * quelques centaines de lignes, charger la table coûte moins qu'un index, et
   * la règle de fusion (`saysTheSame`) est du domaine pur, testable, hors de
   * portée d'une requête SQL.
   */
  async record(draft: LessonDraft): Promise<{ lesson: LessonRow; merged: boolean }> {
    const content = trimLesson(draft.content);
    const keywords = keywordsOf(content);
    const existing = (await this.prisma.assistantLesson.findMany()).map((row) => ({
      row,
      domain: toDomain(row),
    }));

    const twin = existing.find(({ domain }) => saysTheSame(domain, { keywords, nodeTypes: draft.nodeTypes }));
    if (twin) {
      const occurrences = twin.row.occurrences + 1;
      const lesson = await this.prisma.assistantLesson.update({
        where: { id: twin.row.id },
        data: {
          // La formulation la plus RÉCENTE l'emporte : elle vient du cas le plus
          // frais, et une règle réécrite est une règle affinée.
          content,
          keywords,
          nodeTypes: [...new Set([...twin.row.nodeTypes, ...draft.nodeTypes])],
          occurrences,
          status: statusAfterOccurrence(
            twin.row.status as AssistantLesson['status'],
            occurrences,
            Boolean(draft.confirmedBy),
          ),
          confirmedBy: draft.confirmedBy ?? twin.row.confirmedBy,
        },
      });
      this.logger.log(`Leçon réécrite (${occurrences}ᵉ occurrence) : ${content}`);
      return { lesson, merged: true };
    }

    const lesson = await this.prisma.assistantLesson.create({
      data: {
        content,
        keywords,
        nodeTypes: draft.nodeTypes,
        origin: draft.origin,
        originWorkflowId: draft.originWorkflowId ?? null,
        confirmedBy: draft.confirmedBy ?? null,
        status: statusAfterOccurrence('candidate', 1, Boolean(draft.confirmedBy)),
      },
    });
    this.logger.log(`Leçon apprise (${lesson.status}) : ${content}`);
    return { lesson, merged: false };
  }

  /**
   * Les leçons à servir pour ce tour, et le compteur de rappel qui va avec.
   *
   * Le compteur est mis à jour ici et pas à l'affichage : c'est le fait d'avoir
   * été SERVIE qui prouve qu'une leçon vit, et c'est lui qui départagera plus
   * tard celles qu'on retire.
   */
  async recall(nodeTypes: string[], question: string): Promise<LessonRow[]> {
    const rows = await this.prisma.assistantLesson.findMany({ where: { status: 'active' } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const picked = recallLessons(rows.map(toDomain), { nodeTypes, question }).slice(0, MAX_RECALLED);
    if (picked.length > 0) {
      await this.prisma.assistantLesson.updateMany({
        where: { id: { in: picked.map((lesson) => lesson.id) } },
        data: { recalls: { increment: 1 }, lastRecallAt: new Date() },
      });
    }
    return picked.map((lesson) => byId.get(lesson.id)!).filter(Boolean);
  }

  update(id: string, data: { content?: string; status?: string }): Promise<LessonRow> {
    return this.prisma.assistantLesson.update({
      where: { id },
      data: {
        ...(data.content ? { content: trimLesson(data.content), keywords: keywordsOf(data.content) } : {}),
        ...(data.status ? { status: data.status } : {}),
      },
    });
  }

  async remove(id: string): Promise<{ ok: true }> {
    await this.prisma.assistantLesson.delete({ where: { id } });
    return { ok: true };
  }
}
