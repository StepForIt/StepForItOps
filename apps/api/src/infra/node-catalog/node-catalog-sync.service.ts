import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  N8N_API_PORT,
  N8nApiPort,
  N8nInstanceConfig,
  NodeTypeVersionRef,
  NODE_CATALOG_PORT,
  NodeCatalogPort,
  NodeProperty,
} from '@nwm/core';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Alimentation du catalogue. C'est le SEUL endroit qui parle à l'amont.
 *
 * Deux synchronisations, indépendantes :
 *
 * - `syncCatalog()` importe le catalogue mutualisé. Elle ne télécharge que si la
 *   révision amont a bougé — sinon le cron hebdomadaire coûterait 100 Mo par
 *   semaine pour réécrire les mêmes lignes.
 * - `syncInstance()` lit ce que sert une instance n8n. Elle demande un compte
 *   n8n, ces fichiers étant hors de l'API publique ; sans compte, elle le DIT et
 *   n'échoue pas en silence — l'instance continue de fonctionner sur le
 *   catalogue mutualisé, et l'utilisateur doit pouvoir comprendre pourquoi ses
 *   contrôles sont moins précis qu'ailleurs.
 *
 * Chaque passe est journalisée, succès comme échec : sans le journal des échecs,
 * un catalogue périmé ressemble trait pour trait à un catalogue à jour.
 */
@Injectable()
export class NodeCatalogSyncService {
  private readonly logger = new Logger(NodeCatalogSyncService.name);
  /** Une passe à la fois : deux imports concurrents se marcheraient dessus. */
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NODE_CATALOG_PORT) private readonly catalog: NodeCatalogPort,
    @Inject(N8N_API_PORT) private readonly n8n: N8nApiPort,
  ) {}

  /**
   * `force` rejoue l'import même si la révision amont n'a pas bougé — le seul
   * recours quand une passe précédente s'est arrêtée à mi-chemin.
   */
  async syncCatalog(options: { force?: boolean; includeCommunity?: boolean } = {}): Promise<{
    skipped: boolean;
    revision?: string;
    added: number;
    updated: number;
    removed: number;
  }> {
    if (this.running) {
      throw new Error('Une synchronisation du catalogue est déjà en cours.');
    }
    this.running = true;
    try {
      const revision = await this.catalog.revision();
      const last = await this.prisma.nodeCatalogSync.findFirst({
        where: { source: this.catalog.sourceName, error: null },
        orderBy: { at: 'desc' },
      });
      const populated = (await this.prisma.nodeType.count()) > 0;
      if (!options.force && populated && last?.revision === revision.revision) {
        return { skipped: true, revision: revision.revision, added: 0, updated: 0, removed: 0 };
      }

      const types = await this.catalog.fetch({ includeCommunity: options.includeCommunity });
      if (types.length === 0) {
        // Un amont qui rend zéro nœud est un amont cassé, pas un catalogue vide :
        // écraser ce qu'on a par ce néant, c'est perdre le seul exemplaire.
        throw new Error(
          "L'amont n'a rendu aucun type de nœud : import abandonné, le catalogue en base est conservé.",
        );
      }

      const known = new Set(
        (await this.prisma.nodeType.findMany({ select: { nodeType: true } })).map((row) => row.nodeType),
      );
      let added = 0;
      let updated = 0;

      for (const type of types) {
        const data = {
          packageName: type.packageName,
          displayName: type.displayName,
          description: type.description ?? null,
          version: type.version ?? null,
          isTrigger: type.isTrigger,
          isWebhook: type.isWebhook,
          isVersioned: type.isVersioned,
          properties: type.properties as object,
          // `DbNull` et non `null` : en écriture, Prisma réserve `null` au JSON
          // `null` littéral et veut ce marqueur pour vider la colonne.
          operations: (type.operations ?? Prisma.DbNull) as Prisma.InputJsonValue,
          credentials: (type.credentialsRequired ?? Prisma.DbNull) as Prisma.InputJsonValue,
          documentation: type.documentation ?? null,
          source: this.catalog.sourceName,
          fetchedAt: new Date(),
        };
        await this.prisma.nodeType.upsert({
          where: { nodeType: type.nodeType },
          create: { nodeType: type.nodeType, ...data },
          update: data,
        });
        if (known.has(type.nodeType)) updated += 1;
        else added += 1;
        known.delete(type.nodeType);
      }

      // Ce qui restait dans `known` n'est plus décrit par l'amont. On le retire :
      // garder la description d'un nœud que n8n a supprimé ferait contrôler un
      // workflow contre un schéma mort.
      const removed = known.size;
      if (removed > 0) {
        await this.prisma.nodeType.deleteMany({ where: { nodeType: { in: [...known] } } });
      }

      await this.prisma.nodeCatalogSync.create({
        data: {
          source: this.catalog.sourceName,
          revision: revision.revision,
          n8nVersion: revision.n8nVersion ?? null,
          added,
          updated,
          removed,
        },
      });
      this.logger.log(
        `Catalogue ${this.catalog.sourceName} : ${added} ajoutés, ${updated} mis à jour, ${removed} retirés.`,
      );
      return { skipped: false, revision: revision.revision, added, updated, removed };
    } catch (error) {
      await this.prisma.nodeCatalogSync.create({
        data: { source: this.catalog.sourceName, error: (error as Error).message.slice(0, 1000) },
      });
      throw error;
    } finally {
      this.running = false;
    }
  }

  /**
   * Types de nœuds servis par une instance. Le compte n8n manquant n'est pas une
   * panne : c'est un choix de configuration, et il se dit tel quel.
   */
  async syncInstance(
    instanceId: string,
  ): Promise<{ imported: number; removed: number; versions: number; versionsError?: string }> {
    const instance = await this.prisma.instance.findUnique({ where: { id: instanceId } });
    if (!instance) throw new Error('Instance introuvable');
    if (!instance.n8nEmail || !instance.n8nPassword) {
      throw new Error(
        `L'instance « ${instance.name} » n'a pas de compte n8n enregistré. ` +
          `Les types de nœuds ne sont pas servis par l'API publique : renseigne un compte ` +
          `dans la fiche de l'instance, ou reste sur le catalogue mutualisé.`,
      );
    }

    const config = {
      baseUrl: instance.baseUrl,
      apiKey: instance.apiKey,
      login: { email: instance.n8nEmail, password: instance.n8nPassword },
    };

    try {
      const [descriptions, servedVersions] = await Promise.all([
        this.n8n.listNodeTypes(config),
        // Les versions sont un CONFORT : leur absence ne doit pas priver
        // l'instance de ses schémas, qui sont l'essentiel.
        this.n8n.listNodeTypeVersions(config).catch(() => ({}) as Record<string, number[]>),
      ]);

      const seen = new Set<string>();
      let imported = 0;
      for (const description of descriptions) {
        if (!description?.name) continue;
        seen.add(description.name);
        const declared = Array.isArray(description.version)
          ? description.version
          : typeof description.version === 'number'
            ? [description.version]
            : [];
        const all = [...new Set([...(servedVersions[description.name] ?? []), ...declared])].sort(
          (a, b) => a - b,
        );
        const data = {
          displayName: description.displayName ?? description.name,
          description: description.description ?? null,
          version: all.length > 0 ? all[all.length - 1] : null,
          versions: all,
          isTrigger: (description.group ?? []).includes('trigger'),
          isWebhook: Array.isArray(description.webhooks) && description.webhooks.length > 0,
          properties: (description.properties ?? []) as unknown as NodeProperty[] as object,
          credentials: (description.credentials ?? Prisma.DbNull) as Prisma.InputJsonValue,
          fetchedAt: new Date(),
        };
        await this.prisma.instanceNodeType.upsert({
          where: { instanceId_nodeType: { instanceId, nodeType: description.name } },
          create: { instanceId, nodeType: description.name, ...data },
          update: data,
        });
        imported += 1;
      }

      // Un nœud que l'instance ne sert plus (paquet communautaire désinstallé) :
      // sa description ne vaut plus rien ici, et le catalogue mutualisé reprend.
      const stale = await this.prisma.instanceNodeType.findMany({
        where: { instanceId, nodeType: { notIn: [...seen] } },
        select: { id: true },
      });
      if (stale.length > 0) {
        await this.prisma.instanceNodeType.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
      }

      // Les schémas DATÉS, seconde passe et passe faillible : elle appelle une
      // route de plus, couple par couple, et son échec ne doit pas défaire
      // l'import des types, qui est l'essentiel. D'où le journal en succès et
      // l'erreur rendue à côté du compte plutôt qu'à sa place.
      let versions = 0;
      let versionsError: string | undefined;
      try {
        versions = await this.syncInstanceVersions(instanceId, config);
      } catch (error) {
        versionsError = (error as Error).message.slice(0, 300);
        this.logger.warn(`Instance « ${instance.name} » : schémas par version non lus — ${versionsError}`);
      }

      await this.prisma.nodeCatalogSync.create({
        data: { source: `instance:${instanceId}`, added: imported, updated: versions, removed: stale.length },
      });
      this.logger.log(
        `Instance « ${instance.name} » : ${imported} types de nœuds importés, ${versions} schémas datés.`,
      );
      return { imported, removed: stale.length, versions, versionsError };
    } catch (error) {
      await this.prisma.nodeCatalogSync.create({
        data: { source: `instance:${instanceId}`, error: (error as Error).message.slice(0, 1000) },
      });
      throw error;
    }
  }

  /**
   * Les schémas des couples (type, version) réellement EMPLOYÉS par les
   * workflows de l'instance.
   *
   * On part des workflows et non du catalogue : décrire les 800 types dans
   * toutes leurs versions ferait des milliers de lignes pour des nœuds que
   * personne n'utilise, quand un parc réel tient en quelques centaines de
   * couples. Les archivés comptent comme les autres — on les analyse moins,
   * mais un schéma manquant ne se voit qu'au moment où l'on rouvre le workflow.
   *
   * Ce qui n'est PLUS employé est retiré ; ce qui l'est mais n'a pas pu être
   * décrit cette fois-ci est laissé tel quel. Un aller-retour raté ne doit pas
   * coûter un schéma qu'on avait.
   */
  private async syncInstanceVersions(instanceId: string, config: N8nInstanceConfig): Promise<number> {
    const rows = await this.prisma.workflow.findMany({ where: { instanceId }, select: { raw: true } });
    const wanted = new Map<string, NodeTypeVersionRef>();
    for (const row of rows) {
      const nodes =
        (row.raw as { nodes?: Array<{ type?: string; typeVersion?: number }> } | null)?.nodes ?? [];
      for (const node of nodes) {
        const version = Number(node?.typeVersion);
        if (!node?.type || !Number.isFinite(version)) continue;
        wanted.set(`${node.type}@${version}`, { name: node.type, version });
      }
    }

    const known = await this.prisma.instanceNodeTypeVersion.findMany({
      where: { instanceId },
      select: { id: true, nodeType: true, version: true },
    });
    const obsolete = known.filter((row) => !wanted.has(`${row.nodeType}@${row.version}`));
    if (obsolete.length > 0) {
      await this.prisma.instanceNodeTypeVersion.deleteMany({
        where: { id: { in: obsolete.map((row) => row.id) } },
      });
    }
    if (wanted.size === 0) return 0;

    const described = await this.n8n.listNodeTypeDescriptions(config, [...wanted.values()]);
    for (const entry of described) {
      const data = {
        displayName: entry.description.displayName ?? entry.name,
        properties: (entry.description.properties ?? []) as unknown as NodeProperty[] as object,
        fetchedAt: new Date(),
      };
      await this.prisma.instanceNodeTypeVersion.upsert({
        where: {
          instanceId_nodeType_version: { instanceId, nodeType: entry.name, version: entry.version },
        },
        create: { instanceId, nodeType: entry.name, version: entry.version, ...data },
        update: data,
      });
    }
    return described.length;
  }

  /** État affiché dans l'UI : d'où vient le catalogue, et de quand il date. */
  async status(): Promise<{
    nodeTypes: number;
    source: string;
    lastSync?: {
      at: Date;
      revision?: string;
      n8nVersion?: string;
      added: number;
      updated: number;
      removed: number;
    };
    lastError?: { at: Date; message: string };
    instances: Array<{
      instanceId: string;
      name: string;
      hasLogin: boolean;
      nodeTypes: number;
      lastSyncAt?: Date;
    }>;
  }> {
    const [nodeTypes, success, failure, instances] = await Promise.all([
      this.prisma.nodeType.count(),
      this.prisma.nodeCatalogSync.findFirst({
        where: { source: this.catalog.sourceName, error: null },
        orderBy: { at: 'desc' },
      }),
      this.prisma.nodeCatalogSync.findFirst({
        where: { source: this.catalog.sourceName, error: { not: null } },
        orderBy: { at: 'desc' },
      }),
      this.prisma.instance.findMany({
        select: { id: true, name: true, n8nEmail: true, _count: { select: { nodeTypes: true } } },
      }),
    ]);

    const lastRuns = await this.prisma.nodeCatalogSync.findMany({
      where: { source: { in: instances.map((instance) => `instance:${instance.id}`) }, error: null },
      orderBy: { at: 'desc' },
    });
    const lastByInstance = new Map<string, Date>();
    for (const run of lastRuns) {
      if (!lastByInstance.has(run.source)) lastByInstance.set(run.source, run.at);
    }

    return {
      nodeTypes,
      source: this.catalog.sourceName,
      lastSync: success
        ? {
            at: success.at,
            revision: success.revision ?? undefined,
            n8nVersion: success.n8nVersion ?? undefined,
            added: success.added,
            updated: success.updated,
            removed: success.removed,
          }
        : undefined,
      // L'échec n'est montré que s'il est PLUS RÉCENT que le dernier succès :
      // une erreur d'il y a trois mois, déjà rattrapée, n'a rien à alarmer.
      lastError:
        failure && (!success || failure.at > success.at)
          ? { at: failure.at, message: failure.error ?? '' }
          : undefined,
      instances: instances.map((instance) => ({
        instanceId: instance.id,
        name: instance.name,
        hasLogin: Boolean(instance.n8nEmail),
        nodeTypes: instance._count.nodeTypes,
        lastSyncAt: lastByInstance.get(`instance:${instance.id}`),
      })),
    };
  }
}
