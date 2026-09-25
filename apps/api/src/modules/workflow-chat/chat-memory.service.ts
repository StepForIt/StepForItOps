import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { WorkflowChatMemory } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * Longueur d'un fait. Assez pour une règle métier écrite en une phrase, trop
 * court pour qu'on y recopie un bout de workflow — la mémoire n'est pas un second
 * contexte, elle porte ce que le JSON ne dit pas.
 */
const MAX_LENGTH = 400;

/**
 * Plafond par workflow. Au-delà, la mémoire coûterait plus de contexte à chaque
 * tour qu'elle n'en fait gagner, et le modèle noierait les deux faits qui comptent.
 * On refuse d'écrire plutôt que d'évincer en silence : oublier une contrainte de
 * production sans le dire est exactement ce qu'on cherche à éviter.
 */
const MAX_FACTS = 40;

@Injectable()
export class ChatMemoryService {
  private readonly logger = new Logger(ChatMemoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  list(workflowId: string): Promise<WorkflowChatMemory[]> {
    return this.prisma.workflowChatMemory.findMany({
      where: { workflowId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Enregistre un fait. Le même contenu ne s'écrit qu'une fois (contrainte
   * unique) : l'assistant le rappelle volontiers d'un tour à l'autre, et sans ça
   * la mémoire se remplirait de doublons au lieu de faits.
   */
  async remember(
    workflowId: string,
    content: string,
    sessionId: string | null,
  ): Promise<{ stored: boolean; reason?: string }> {
    const fact = content?.trim();
    if (!fact) throw new BadRequestException('Fait vide');
    if (fact.length > MAX_LENGTH) {
      return {
        stored: false,
        reason: `Fait trop long (${fact.length} caractères, maximum ${MAX_LENGTH}) : garde la contrainte, pas son contexte.`,
      };
    }

    const existing = await this.prisma.workflowChatMemory.count({ where: { workflowId } });
    if (existing >= MAX_FACTS) {
      return {
        stored: false,
        reason: `Mémoire pleine (${MAX_FACTS} faits) : demande à l'utilisateur d'en retirer depuis le tiroir avant d'en ajouter.`,
      };
    }

    try {
      await this.prisma.workflowChatMemory.create({ data: { workflowId, content: fact, sessionId } });
      return { stored: true };
    } catch (error) {
      // Contrainte unique : le fait est déjà là, ce qui est le résultat voulu.
      this.logger.debug(`Fait déjà mémorisé (${workflowId}) : ${(error as Error).message}`);
      return { stored: false, reason: 'Ce fait était déjà mémorisé.' };
    }
  }

  async forget(id: string): Promise<{ ok: true }> {
    await this.prisma.workflowChatMemory.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Les faits, rendus pour le contexte du tour. `null` quand il n'y en a aucun :
   * une rubrique vide dans le prompt invite le modèle à la remplir de généralités.
   */
  async brief(workflowId: string): Promise<string | null> {
    const facts = await this.list(workflowId);
    if (facts.length === 0) return null;
    return facts.map((fact) => `- ${fact.content}`).join('\n');
  }
}
