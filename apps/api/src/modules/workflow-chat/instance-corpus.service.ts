import { Injectable } from '@nestjs/common';
import { N8nWorkflow } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * Durée de vie du cache. Un tour de conversation interroge le corpus plusieurs
 * fois (credentials d'un nœud ajouté, formes de paramètres, outils du modèle), et
 * relire tous les workflows de l'instance à chaque question coûte plus que la
 * fraîcheur ne rapporte : le corpus sert de NORME, pas d'état courant — c'est
 * `getFreshRaw` qui répond de l'état, et lui ne cache rien.
 */
const TTL_MS = 30_000;

/**
 * Tous les workflows d'une instance, tels que n8n les a rendus.
 *
 * Ce que la plateforme sait de n8n mais que son API publique ne dit pas se lit
 * ici : quelles credentials existent, quelle forme ont les paramètres d'un type
 * de nœud. Un seul chargement, partagé — sans quoi chaque question refaisait la
 * même lecture complète.
 */
@Injectable()
export class InstanceCorpusService {
  private readonly cache = new Map<string, { at: number; raws: N8nWorkflow[] }>();

  constructor(private readonly prisma: PrismaService) {}

  async raws(instanceId: string): Promise<N8nWorkflow[]> {
    const known = this.cache.get(instanceId);
    if (known && Date.now() - known.at < TTL_MS) return known.raws;

    const rows = await this.prisma.workflow.findMany({
      where: { instanceId },
      select: { raw: true },
    });
    const raws = rows.map((row) => row.raw as unknown as N8nWorkflow);
    this.cache.set(instanceId, { at: Date.now(), raws });
    return raws;
  }
}
