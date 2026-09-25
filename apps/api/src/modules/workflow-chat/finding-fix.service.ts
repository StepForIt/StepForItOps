import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Finding } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ChatService } from './chat.service';

const TITLE_MAX = 60;

export interface FindingFixResult {
  workflowId: string;
  sessionId: string;
  /** null si l'IA a répondu sans proposer de modification (pas de correctif sûr). */
  proposalId: string | null;
  reply: string;
}

/**
 * Pont findings → assistant. Un finding qui décrit un problème sans permettre de
 * le corriger oblige à tout refaire à la main dans n8n : ici il devient une
 * conversation pré-alimentée, et l'IA répond par une proposition d'édition
 * revue en diff avant tout PUT vers n8n, comme n'importe quelle proposition du chat.
 *
 * On accepte PLUSIEURS findings à la fois : les remarques d'un même nœud Code se
 * corrigent d'une seule réécriture, et les traiter une par une produirait des
 * propositions qui s'écrasent l'une l'autre.
 */
@Injectable()
export class FindingFixService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
  ) {}

  async proposeFix(findingIds: string[]): Promise<FindingFixResult> {
    if (findingIds.length === 0) throw new BadRequestException('Aucun finding à corriger');
    const findings = await this.prisma.finding.findMany({
      where: { id: { in: findingIds } },
      include: { workflow: { select: { name: true } } },
    });
    if (findings.length === 0) throw new NotFoundException('Findings introuvables');

    const workflowId = findings[0]!.workflowId;
    if (findings.some((finding) => finding.workflowId !== workflowId)) {
      // Une session de chat porte sur UN workflow : mélanger les cibles produirait
      // une proposition appliquée au mauvais workflow.
      throw new BadRequestException('Les findings doivent appartenir au même workflow');
    }

    const session = await this.chat.createSession(workflowId);
    await this.prisma.workflowChatSession.update({
      where: { id: session.id },
      data: { title: fixTitle(findings).slice(0, TITLE_MAX) },
    });

    const result = await this.chat.sendMessage(session.id, buildFixRequest(findings), {
      focusNodes: findings.map((finding) => finding.nodeName).filter((name): name is string => Boolean(name)),
    });
    return {
      workflowId,
      sessionId: session.id,
      proposalId: result.proposalId,
      // Le tour peut avoir été arrêté depuis le tiroir : il n'a alors rien écrit.
      reply: result.assistantMessage?.content ?? 'Le tour a été arrêté avant toute réponse.',
    };
  }
}

/** Titre de la conversation : le nœud visé s'il est unique, sinon le nombre de remarques. */
function fixTitle(findings: Finding[]): string {
  const nodes = new Set(findings.map((finding) => finding.nodeName).filter(Boolean));
  if (nodes.size === 1) return `Correctif : ${[...nodes][0]}`;
  return `Correctif : ${findings.length} finding(s)`;
}

interface FindingData {
  suggestion?: string;
  line?: number;
  snippet?: string;
}

function buildFixRequest(findings: Finding[]): string {
  const lines = findings.map((finding) => {
    const data = (finding.data ?? {}) as FindingData;
    const where = [
      finding.nodeName ? `nœud « ${finding.nodeName} »` : null,
      data.line ? `ligne ${data.line}` : null,
    ]
      .filter(Boolean)
      .join(', ');
    return [
      `- [${finding.severity}] ${finding.message}`,
      where ? `  où : ${where}` : null,
      data.snippet ? `  code :\n${indent(data.snippet, 4)}` : null,
      data.suggestion ? `  piste déjà identifiée : ${data.suggestion}` : null,
    ]
      .filter(Boolean)
      .join('\n');
  });

  return [
    `L'analyse de ce workflow a remonté ${findings.length === 1 ? 'ce problème' : 'ces problèmes'}, et je veux ${findings.length === 1 ? 'le' : 'les'} corriger.`,
    ``,
    ...lines,
    ``,
    `Propose la modification MINIMALE qui corrige la cause. Ne réécris pas ce qui n'est pas visé,`,
    `et ne « nettoie » rien au passage : le diff doit se relire en quelques secondes.`,
    `Si une remarque est en fait un faux positif (valeur volontairement laissée en gabarit,`,
    `convention maison, comportement voulu), dis-le et ne la corrige PAS — je la déclarerai normale.`,
  ].join('\n');
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => pad + line)
    .join('\n');
}
