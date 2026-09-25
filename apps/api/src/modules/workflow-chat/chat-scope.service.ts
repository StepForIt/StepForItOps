import { Injectable, Logger } from '@nestjs/common';
import { N8nWorkflow, SCOPE_MAX_DEPTH, SCOPE_MAX_MEMBERS, ScopeMember, subWorkflowCalls } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** Un membre du périmètre, avec ce qu'il faut pour l'ÉCRIRE et non seulement le nommer. */
export interface ChatScopeMember extends ScopeMember {
  instanceId: string;
  /**
   * n8n refuserait toute écriture : workflow archivé chez lui, ou qu'il ne
   * connaît plus. Lisible quand même — c'est souvent là qu'est la réponse — mais
   * la proposition doit le dire AVANT de bâtir un diff qui ne partira jamais.
   */
  readOnly: boolean;
  /** Pourquoi il ne s'écrit pas. Vide quand il s'écrit. */
  readOnlyReason?: string;
}

/**
 * Le périmètre d'une conversation : le workflow ouvert, plus les sous-workflows
 * qu'il appelle.
 *
 * La descente se fait sur le MIROIR local, pas sur n8n : construire le périmètre
 * coûterait autant de requêtes que de membres, à chaque tour, pour des noms et
 * un câblage qui ne bougent pas d'une heure sur l'autre. Le contenu d'un membre,
 * lui, est relu dans n8n au moment où l'assistant le demande vraiment
 * (`read_workflow`), et l'application le relit une dernière fois avant d'écrire :
 * un miroir en retard ne peut donc pas se retrouver renvoyé à n8n.
 */
@Injectable()
export class ChatScopeService {
  private readonly logger = new Logger(ChatScopeService.name);

  constructor(private readonly prisma: PrismaService) {}

  async build(rootWorkflowId: string): Promise<ChatScopeMember[]> {
    const root = await this.load(rootWorkflowId);
    if (!root) return [];

    const members: ChatScopeMember[] = [{ ...root, depth: 0, calledBy: [] }];
    const seen = new Set([root.workflowId]);
    // Parcours en LARGEUR : à membres plafonnés, ce sont les sous-workflows
    // directement appelés qu'on veut garder, jamais le fond d'une seule branche.
    let frontier: Array<{ member: ChatScopeMember; raw: N8nWorkflow }> = [
      { member: members[0]!, raw: root.raw },
    ];

    for (let depth = 1; depth <= SCOPE_MAX_DEPTH && frontier.length > 0; depth += 1) {
      const next: Array<{ member: ChatScopeMember; raw: N8nWorkflow }> = [];
      for (const { member, raw } of frontier) {
        for (const call of subWorkflowCalls(raw)) {
          if (members.length >= SCOPE_MAX_MEMBERS) break;
          const found = await this.loadByN8nId(member.instanceId, call.externalId);
          if (!found) {
            // Un appelé que la plateforme n'a jamais synchronisé n'entre pas dans
            // le périmètre : on ne saurait ni le lire ni l'écrire. Le contexte
            // le dira, plutôt que de le taire.
            continue;
          }
          if (seen.has(found.workflowId)) continue;
          seen.add(found.workflowId);
          const entry: ChatScopeMember = {
            ...found,
            depth,
            calledBy: call.nodes.map((node) => `« ${member.name} » → ${node}`),
          };
          members.push(entry);
          next.push({ member: entry, raw: found.raw });
        }
      }
      frontier = next;
    }
    return members;
  }

  /**
   * Les sous-workflows appelés que la plateforme ne connaît pas : ni lisibles ni
   * modifiables. Dit au modèle plutôt que passé sous silence — un trou annoncé
   * vaut mieux qu'un périmètre qui paraît complet.
   */
  async unknownCalls(
    raw: N8nWorkflow,
    instanceId: string,
  ): Promise<Array<{ externalId: string; label?: string }>> {
    const unknown: Array<{ externalId: string; label?: string }> = [];
    for (const call of subWorkflowCalls(raw)) {
      const found = await this.loadByN8nId(instanceId, call.externalId);
      if (!found) unknown.push({ externalId: call.externalId, ...(call.label ? { label: call.label } : {}) });
    }
    return unknown;
  }

  private async load(
    workflowId: string,
  ): Promise<(Omit<ChatScopeMember, 'depth' | 'calledBy'> & { raw: N8nWorkflow }) | null> {
    const row = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
      select: {
        id: true,
        instanceId: true,
        externalId: true,
        name: true,
        raw: true,
        archivedUpstream: true,
        missingUpstreamAt: true,
      },
    });
    return row ? this.toMember(row) : null;
  }

  private async loadByN8nId(
    instanceId: string,
    externalId: string,
  ): Promise<(Omit<ChatScopeMember, 'depth' | 'calledBy'> & { raw: N8nWorkflow }) | null> {
    const row = await this.prisma.workflow.findUnique({
      where: { instanceId_externalId: { instanceId, externalId } },
      select: {
        id: true,
        instanceId: true,
        externalId: true,
        name: true,
        raw: true,
        archivedUpstream: true,
        missingUpstreamAt: true,
      },
    });
    return row ? this.toMember(row) : null;
  }

  private toMember(row: {
    id: string;
    instanceId: string;
    externalId: string;
    name: string;
    raw: unknown;
    archivedUpstream: boolean;
    missingUpstreamAt: Date | null;
  }): Omit<ChatScopeMember, 'depth' | 'calledBy'> & { raw: N8nWorkflow } {
    const reason = row.missingUpstreamAt
      ? 'n8n ne connaît plus ce workflow : rien ne peut y être écrit.'
      : row.archivedUpstream
        ? 'archivé côté n8n : toute écriture est refusée tant qu’il ne l’est plus.'
        : undefined;
    return {
      workflowId: row.id,
      instanceId: row.instanceId,
      externalId: row.externalId,
      name: row.name,
      raw: row.raw as N8nWorkflow,
      readOnly: Boolean(reason),
      ...(reason ? { readOnlyReason: reason } : {}),
    };
  }
}
