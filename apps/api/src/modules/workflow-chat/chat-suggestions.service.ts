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
 * Les demandes courantes de la maison. Elles amorcent la complétion sur un
 * workflow dont personne n'a encore rien demandé : sans elles, l'aide à la
 * frappe n'existerait qu'une fois la conversation vieille, c'est-à-dire quand on
 * n'en a plus besoin.
 */
const COMMON_PHRASES = [
  'Explique-moi ce que fait ce workflow, étape par étape.',
  'Quels sont les points de fragilité (erreurs non gérées, données manquantes) ?',
  'Ajoute une note explicative sur chaque nœud sans nom clair.',
  'Ajoute un retry et un timeout sur les appels HTTP.',
  'Pourquoi ce workflow échoue-t-il en production ?',
  'Renomme les nœuds pour que leur rôle soit lisible.',
  'Que se passe-t-il si la réponse est vide ?',
  'Propose une gestion d’erreur pour ce nœud : ',
];

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
      // L'historique d'abord : à égalité de préfixe, ce que l'équipe écrit
      // vraiment prime sur le catalogue, et le dédoublonnage garde le premier.
      phrases: [...new Set([...history, ...COMMON_PHRASES])],
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
