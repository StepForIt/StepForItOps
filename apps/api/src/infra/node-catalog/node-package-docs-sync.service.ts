import { Inject, Injectable, Logger } from '@nestjs/common';
import { PACKAGE_DOCS_PORT, PackageDocsPort } from '@nwm/core';
import { PrismaService } from '../prisma/prisma.service';
import { CommunityPackagesService } from './community-packages.service';

export type PackageDocOutcome = 'fetched' | 'unchanged' | 'none' | 'failed';

/**
 * Récupération des README des paquets communautaires. C'est le SEUL endroit qui
 * appelle le registre npm : l'assistant, lui, ne lit que la base.
 *
 * Un README n'est relu que si la version installée n'a pas encore le sien. Un
 * paquet dont la version est inconnue n'est lu qu'une fois : relire la dernière
 * version chaque semaine réécrirait la même ligne pour rien.
 */
@Injectable()
export class NodePackageDocsSyncService {
  private readonly logger = new Logger(NodePackageDocsSyncService.name);
  /** Paquets en cours de lecture : deux tours de chat ne relancent pas le même appel. */
  private readonly pending = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly packages: CommunityPackagesService,
    @Inject(PACKAGE_DOCS_PORT) private readonly source: PackageDocsPort,
  ) {}

  async refreshPackage(
    packageName: string,
    versions: string[] = [],
    options: { force?: boolean } = {},
  ): Promise<PackageDocOutcome> {
    if (!options.force) {
      const known = await this.prisma.nodePackageDoc.findMany({
        where: { packageName, kind: 'auto' },
        select: { version: true },
      });
      const covered =
        versions.length === 0
          ? known.length > 0
          : versions.every((v) => known.some((row) => row.version === v));
      if (covered) return 'unchanged';
    }

    // Une version installée par instance : on les lit toutes, la plus récente en dernier.
    const wanted: Array<string | undefined> = versions.length > 0 ? versions : [undefined];
    let outcome: PackageDocOutcome = 'none';
    for (const version of wanted) {
      try {
        const readme = await this.source.readme(packageName, version);
        if (!readme) continue;
        const data = {
          source: readme.source,
          url: readme.url ?? null,
          content: readme.content,
          fetchedAt: new Date(),
        };
        const key = { packageName, kind: 'auto', version: readme.version ?? '' };
        await this.prisma.nodePackageDoc.upsert({
          where: { packageName_kind_version: key },
          create: { ...key, ...data },
          update: data,
        });
        outcome = 'fetched';
      } catch (error) {
        this.logger.warn(
          `README of ${packageName}${version ? `@${version}` : ''} not read: ${(error as Error).message}`,
        );
        if (outcome === 'none') outcome = 'failed';
      }
    }
    return outcome;
  }

  /** Tous les paquets du parc. Un paquet en échec ne prive pas les autres de leur passe. */
  async refreshAll(options: { force?: boolean } = {}): Promise<Record<PackageDocOutcome, number>> {
    const counts: Record<PackageDocOutcome, number> = { fetched: 0, unchanged: 0, none: 0, failed: 0 };
    const uses = await this.packages.inUse();
    for (const use of uses) {
      counts[await this.refreshPackage(use.packageName, use.versions, options)] += 1;
    }
    await this.prune(new Map(uses.map((use) => [use.packageName, use.versions])));
    return counts;
  }

  /**
   * Lecture en arrière-plan de ce qui manque, déclenchée par un tour de chat :
   * le tour n'attend pas (la doc sera là au suivant), et rien ne part deux fois.
   */
  ensureInBackground(packageNames: string[]): void {
    for (const packageName of packageNames) {
      if (this.pending.has(packageName)) continue;
      this.pending.add(packageName);
      void this.refreshPackage(packageName)
        .catch(() => undefined)
        .finally(() => this.pending.delete(packageName));
    }
  }

  /**
   * Retire les README de versions qui ne sont plus installées nulle part, en
   * gardant toujours le plus récent : un paquet mis à jour ne doit pas se
   * retrouver sans doc le temps de la passe suivante.
   */
  private async prune(installed: Map<string, string[]>): Promise<void> {
    const rows = await this.prisma.nodePackageDoc.findMany({
      where: { kind: 'auto' },
      select: { id: true, packageName: true, version: true, fetchedAt: true },
      orderBy: { fetchedAt: 'desc' },
    });
    const newest = new Set<string>();
    const obsolete: string[] = [];
    for (const row of rows) {
      const versions = installed.get(row.packageName);
      const isNewest = !newest.has(row.packageName);
      newest.add(row.packageName);
      if (isNewest || !versions || versions.length === 0 || versions.includes(row.version)) continue;
      obsolete.push(row.id);
    }
    if (obsolete.length > 0) await this.prisma.nodePackageDoc.deleteMany({ where: { id: { in: obsolete } } });
  }
}
