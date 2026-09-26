import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  N8N_API_PORT,
  N8nApiPort,
  N8nInstanceConfig,
  communityPackagesOf,
  isCommunityNodeType,
  nodePackageOf,
} from '@nwm/core';
import { PrismaService } from '../prisma/prisma.service';

/** Un paquet communautaire du parc : où il sert, et en quelle(s) version(s). */
export interface CommunityPackageUse {
  packageName: string;
  instanceIds: string[];
  /** Versions installées connues ; vide quand aucune instance ne l'a dit. */
  versions: string[];
  nodeTypes: string[];
}

/**
 * Inventaire des paquets de nœuds communautaires.
 *
 * Deux sources, parce qu'aucune ne suffit : les workflows disent ce qui SERT
 * (lisible sur toute instance, sans compte n8n), l'instance dit ce qui est
 * INSTALLÉ et en quelle version (compte propriétaire ou admin). Un paquet
 * installé que personne n'emploie compte aussi : c'est celui qu'on s'apprête à
 * utiliser, et c'est là que l'assistant a besoin de son mode d'emploi.
 */
@Injectable()
export class CommunityPackagesService {
  private readonly logger = new Logger(CommunityPackagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(N8N_API_PORT) private readonly n8n: N8nApiPort,
  ) {}

  /**
   * Relève les paquets installés sur une instance, à partir des types qu'elle
   * sert (déjà importés) et de `/rest/community-packages` pour la version. Ce
   * second appel est un confort : refusé, les paquets restent connus sans version.
   */
  async recordInstance(instanceId: string, config: N8nInstanceConfig): Promise<number> {
    const types = await this.prisma.instanceNodeType.findMany({
      where: { instanceId },
      select: { nodeType: true },
    });
    const versions = new Map<string, string | undefined>();
    for (const { nodeType } of types) {
      if (isCommunityNodeType(nodeType)) versions.set(nodePackageOf(nodeType) as string, undefined);
    }
    try {
      for (const entry of await this.n8n.listCommunityPackages(config)) {
        versions.set(entry.packageName, entry.installedVersion);
      }
    } catch (error) {
      this.logger.warn(`Community package versions not read: ${(error as Error).message}`);
    }

    for (const [packageName, version] of versions) {
      await this.prisma.instanceNodePackage.upsert({
        where: { instanceId_packageName: { instanceId, packageName } },
        create: { instanceId, packageName, version: version ?? null },
        update: { version: version ?? null, fetchedAt: new Date() },
      });
    }
    await this.prisma.instanceNodePackage.deleteMany({
      where: { instanceId, packageName: { notIn: [...versions.keys()] } },
    });
    return versions.size;
  }

  /** Les paquets du parc, installés ou employés. */
  async inUse(): Promise<CommunityPackageUse[]> {
    const byPackage = new Map<
      string,
      { instances: Set<string>; versions: Set<string>; types: Set<string> }
    >();
    const entry = (packageName: string) => {
      let found = byPackage.get(packageName);
      if (!found) {
        found = { instances: new Set(), versions: new Set(), types: new Set() };
        byPackage.set(packageName, found);
      }
      return found;
    };

    const [installed, workflows] = await Promise.all([
      this.prisma.instanceNodePackage.findMany(),
      this.prisma.workflow.findMany({
        where: { instance: { platform: 'n8n' } },
        select: { instanceId: true, raw: true },
      }),
    ]);
    for (const row of installed) {
      const found = entry(row.packageName);
      found.instances.add(row.instanceId);
      if (row.version) found.versions.add(row.version);
    }
    for (const workflow of workflows) {
      for (const used of communityPackagesOf(workflow.raw as { nodes?: Array<{ type: string }> })) {
        const found = entry(used.packageName);
        found.instances.add(workflow.instanceId);
        used.nodeTypes.forEach((type) => found.types.add(type));
      }
    }
    return [...byPackage]
      .map(([packageName, found]) => ({
        packageName,
        instanceIds: [...found.instances],
        versions: [...found.versions].sort(),
        nodeTypes: [...found.types].sort(),
      }))
      .sort((a, b) => a.packageName.localeCompare(b.packageName));
  }

  /** Version installée d'un paquet sur une instance, quand elle l'a dite. */
  async installedVersion(instanceId: string | undefined, packageName: string): Promise<string | undefined> {
    if (!instanceId) return undefined;
    const row = await this.prisma.instanceNodePackage.findUnique({
      where: { instanceId_packageName: { instanceId, packageName } },
    });
    return row?.version ?? undefined;
  }
}
