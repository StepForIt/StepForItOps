import { Injectable } from '@nestjs/common';
import {
  CheckFinding,
  N8nWorkflow,
  NodeProperty,
  NodeSchema,
  runNodeSchemaChecks,
  schemaKey,
} from '@nwm/core';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Le catalogue, côté lecture.
 *
 * Deux sources et un ordre : ce que SERT l'instance prime sur le catalogue
 * mutualisé. La raison est que l'instance décrit le n8n qui exécutera vraiment le
 * workflow — sa version, ses nœuds communautaires — quand le catalogue décrit un
 * n8n voisin, proche mais jamais garanti identique. La provenance suit le schéma
 * jusqu'au finding (`NodeSchema.source`), de sorte que le message dise à quoi il
 * confronte : c'est la différence entre « n8n n'accepte pas ça » et « aucun autre
 * n8n ne fait ça ».
 *
 * Aucun appel réseau ici : tout est en base. Le jour où l'amont disparaît, cette
 * classe ne s'en aperçoit pas.
 */
@Injectable()
export class NodeCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Schémas des types PRÉSENTS dans ce workflow. On ne charge pas le catalogue
   * entier pour trois nœuds : les `properties` d'un seul nœud Notion pèsent
   * 500 Ko, et le tableau complet dépasse les 20 Mo.
   *
   * Les couples (type, version) partent avec : c'est ce qui permet de servir le
   * schéma DATÉ d'un nœud en typeVersion 2, quand le catalogue n'en décrit
   * que la 3.
   */
  async schemasFor(workflow: N8nWorkflow, instanceId?: string): Promise<Map<string, NodeSchema>> {
    const nodes = workflow.nodes ?? [];
    const types = [...new Set(nodes.map((node) => node.type))];
    const refs = [
      ...new Map(
        nodes
          .filter((node) => typeof node.typeVersion === 'number')
          .map((node) => [
            schemaKey(node.type, node.typeVersion),
            { name: node.type, version: node.typeVersion as number },
          ]),
      ).values(),
    ];
    return this.schemasOf(types, instanceId, refs);
  }

  /**
   * Schémas d'une liste de types, du plus précis au plus général :
   * l'instance version pour version, puis l'instance dans sa version courante,
   * puis le catalogue mutualisé. `runNodeSchemaChecks` lit la carte dans cet
   * ordre par `schemaKey`, et la règle « version pour version » fait le reste :
   * un schéma daté juge, un schéma d'une autre version se tait.
   */
  async schemasOf(
    types: string[],
    instanceId?: string,
    refs: Array<{ name: string; version: number }> = [],
  ): Promise<Map<string, NodeSchema>> {
    const schemas = new Map<string, NodeSchema>();
    if (types.length === 0) return schemas;

    if (instanceId && refs.length > 0) {
      const dated = await this.prisma.instanceNodeTypeVersion.findMany({
        where: { instanceId, OR: refs.map((ref) => ({ nodeType: ref.name, version: ref.version })) },
      });
      for (const row of dated) {
        schemas.set(schemaKey(row.nodeType, row.version), {
          nodeType: row.nodeType,
          displayName: row.displayName,
          version: row.version,
          properties: (row.properties as unknown as NodeProperty[]) ?? [],
          source: 'instance',
        });
      }
    }

    if (instanceId) {
      const rows = await this.prisma.instanceNodeType.findMany({
        where: { instanceId, nodeType: { in: types } },
      });
      for (const row of rows) {
        schemas.set(row.nodeType, {
          nodeType: row.nodeType,
          displayName: row.displayName,
          version: row.version ?? undefined,
          properties: (row.properties as unknown as NodeProperty[]) ?? [],
          source: 'instance',
        });
      }
    }

    const missing = types.filter((type) => !schemas.has(type));
    if (missing.length > 0) {
      const rows = await this.prisma.nodeType.findMany({ where: { nodeType: { in: missing } } });
      for (const row of rows) {
        schemas.set(row.nodeType, {
          nodeType: row.nodeType,
          displayName: row.displayName,
          version: row.version ?? undefined,
          properties: (row.properties as unknown as NodeProperty[]) ?? [],
          source: 'catalog',
        });
      }
    }
    return schemas;
  }

  /** Findings de conformité au schéma, pour un workflow. */
  async check(workflow: N8nWorkflow, instanceId?: string): Promise<CheckFinding[]> {
    return runNodeSchemaChecks(workflow, await this.schemasFor(workflow, instanceId));
  }

  /**
   * Un type de nœud, tel qu'on le rend à l'assistant : les paramètres SANS leurs
   * `displayOptions` ni leurs descriptions longues rempliraient le contexte pour
   * rien, mais un `options` amputé de ses valeurs admises ferait inventer une
   * `operation`. On garde donc la structure et on coupe la prose.
   */
  async describe(
    nodeType: string,
    instanceId?: string,
  ): Promise<{
    nodeType: string;
    displayName: string;
    description?: string;
    version?: number;
    /** Versions servies par l'instance, quand elle a été synchronisée. */
    versions?: number[];
    source: 'instance' | 'catalog';
    properties: NodeProperty[];
    operations?: unknown;
    documentation?: string;
  } | null> {
    if (instanceId) {
      const row = await this.prisma.instanceNodeType.findUnique({
        where: { instanceId_nodeType: { instanceId, nodeType } },
      });
      if (row) {
        return {
          nodeType: row.nodeType,
          displayName: row.displayName,
          description: row.description ?? undefined,
          version: row.version ?? undefined,
          versions: row.versions.length > 0 ? row.versions : undefined,
          source: 'instance',
          properties: (row.properties as unknown as NodeProperty[]) ?? [],
          // La doc n'est pas servie par l'instance : elle ne vit que dans le
          // catalogue mutualisé, d'où cette jointure à la main.
          documentation:
            (await this.prisma.nodeType.findUnique({ where: { nodeType } }))?.documentation ?? undefined,
        };
      }
    }
    const row = await this.prisma.nodeType.findUnique({ where: { nodeType } });
    if (!row) return null;
    return {
      nodeType: row.nodeType,
      displayName: row.displayName,
      description: row.description ?? undefined,
      version: row.version ?? undefined,
      source: 'catalog',
      properties: (row.properties as unknown as NodeProperty[]) ?? [],
      operations: row.operations ?? undefined,
      documentation: row.documentation ?? undefined,
    };
  }

  /**
   * Recherche par nom. Sert à l'assistant qui sait ce qu'il veut faire (« envoyer
   * un SMS ») mais pas sous quel type n8n le range : sans elle, il invente un
   * `n8n-nodes-base.sms` qui n'existe pas et le nœud ne s'ouvre jamais.
   */
  async search(
    query: string,
    limit = 15,
  ): Promise<Array<{ nodeType: string; displayName: string; description?: string }>> {
    const term = query.trim();
    if (term.length < 2) return [];
    const rows = await this.prisma.nodeType.findMany({
      where: {
        OR: [
          { displayName: { contains: term, mode: 'insensitive' } },
          { nodeType: { contains: term, mode: 'insensitive' } },
          { description: { contains: term, mode: 'insensitive' } },
        ],
      },
      select: { nodeType: true, displayName: true, description: true },
      orderBy: { displayName: 'asc' },
      take: limit,
    });
    return rows.map((row) => ({
      nodeType: row.nodeType,
      displayName: row.displayName,
      description: row.description ?? undefined,
    }));
  }

  /** Le catalogue est-il alimenté ? Un contrôle qui s'appuie dessus doit le savoir. */
  async isPopulated(): Promise<boolean> {
    return (await this.prisma.nodeType.count()) > 0;
  }
}
