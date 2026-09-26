import { Injectable } from '@nestjs/common';
import { CompletionSources, N8nWorkflow, flattenModules, isMakeBlueprint, moduleLabel } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { WorkflowsService } from '../workflows/workflows.service';

export type ChatCompletionSources = CompletionSources;

/** Longueur au-delà de laquelle une demande passée n'est plus une phrase à recopier. */
const PHRASE_MAX = 160;
/** Demandes déjà écrites reprises comme complétions (des plus récentes aux plus vieilles). */
const HISTORY_LIMIT = 60;

/**
 * De quoi compléter la frappe dans la saisie du chat.
 *
 * Lu du miroir local et jamais de n8n : c'est un confort de saisie, pas un
 * chemin d'écriture — un nom de nœud d'hier vaut mieux qu'un tiroir qui s'ouvre
 * une seconde plus tard, et la complétion ne fait qu'écrire du texte que
 * l'utilisateur relit.
 */
@Injectable()
export class ChatSuggestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowsService,
  ) {}

  async sources(workflowId: string): Promise<ChatCompletionSources> {
    const [{ workflow, raw }, written] = await Promise.all([
      this.workflows.getRawAny(workflowId),
      this.prisma.workflowChatMessage.findMany({
        where: { role: 'user', session: { workflowId } },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_LIMIT,
        select: { content: true },
      }),
    ]);

    // La première ligne seule : une demande de dix lignes n'est pas une phrase
    // qu'on retape, et la proposer déroulerait un pavé sous la frappe.
    const history = written
      .map((message) => message.content.split('\n')[0]!.trim())
      .filter((phrase) => phrase.length > 0 && phrase.length <= PHRASE_MAX);

    return {
      // L'historique seul : le catalogue des demandes courantes vit côté web, dans la langue affichée.
      phrases: [...new Set(history)],
      nodeNames: [...new Set(itemNames(workflow.platform, raw).filter(Boolean))],
    };
  }
}

/** Les noms à compléter : nœuds n8n, ou modules d'un scénario Make. */
function itemNames(platform: string, raw: unknown): string[] {
  if (platform === 'make') {
    return isMakeBlueprint(raw) ? flattenModules(raw).map((flat) => moduleLabel(flat.module)) : [];
  }
  return ((raw as N8nWorkflow).nodes ?? []).map((node) => node.name);
}
