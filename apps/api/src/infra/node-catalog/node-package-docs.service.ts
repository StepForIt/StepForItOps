import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  PACKAGE_DOCS_PORT,
  PackageDocsPort,
  communityPackagesOf,
  demoteHeadings,
  isCommunityNodeType,
  nodePackageOf,
  readDocSection,
  msg,
} from '@nwm/core';
import { PrismaService } from '../prisma/prisma.service';
import { CommunityPackagesService } from './community-packages.service';

/** Plafond d'une doc manuelle : au-delà, c'est une copie de site, pas une note d'équipe. */
const MAX_MANUAL_CHARS = 200_000;

/** Une doc disponible, telle qu'on l'annonce avant de la lire. */
export interface PackageDocSummary {
  kind: 'auto' | 'manual';
  source: string;
  version?: string;
  url?: string;
  chars: number;
  fetchedAt: Date;
  updatedBy?: string;
}

/** Ce que le contexte d'un tour annonce d'un paquet communautaire du workflow. */
export interface PackageDocAnnounce {
  packageName: string;
  nodeTypes: string[];
  installedVersion?: string;
  docs: PackageDocSummary[];
}

type DocRow = {
  kind: string;
  source: string;
  version: string;
  url: string | null;
  content: string;
  fetchedAt: Date;
  updatedBy: string | null;
};

function summary(row: DocRow): PackageDocSummary {
  return {
    kind: row.kind === 'manual' ? 'manual' : 'auto',
    source: row.source,
    ...(row.version ? { version: row.version } : {}),
    ...(row.url ? { url: row.url } : {}),
    chars: row.content.length,
    fetchedAt: row.fetchedAt,
    ...(row.updatedBy ? { updatedBy: row.updatedBy } : {}),
  };
}

/**
 * Le mode d'emploi des paquets communautaires, côté lecture et saisie humaine.
 * Aucun appel réseau à la lecture — sauf pour une doc manuelle désignée par URL,
 * lue une fois à l'enregistrement.
 */
@Injectable()
export class NodePackageDocsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly packages: CommunityPackagesService,
    @Inject(PACKAGE_DOCS_PORT) private readonly source: PackageDocsPort,
  ) {}

  /**
   * Les docs d'un paquet, la manuelle d'abord puis le README de la version
   * installée — à défaut le plus récent, et `installedVersion` le laisse voir.
   */
  async docsOf(
    packageName: string,
    instanceId?: string,
  ): Promise<{ installedVersion?: string; rows: DocRow[] }> {
    const installedVersion = await this.packages.installedVersion(instanceId, packageName);
    const rows = await this.prisma.nodePackageDoc.findMany({
      where: { packageName },
      orderBy: { fetchedAt: 'desc' },
    });
    const manual = rows.find((row) => row.kind === 'manual');
    const autos = rows.filter((row) => row.kind === 'auto');
    const auto = autos.find((row) => installedVersion && row.version === installedVersion) ?? autos[0];
    return { installedVersion, rows: [manual, auto].filter((row) => row !== undefined) };
  }

  /** Les paquets communautaires d'un workflow et leurs docs, pour le contexte du tour. */
  async announce(
    workflow: { nodes?: Array<{ type: string }> },
    instanceId?: string,
  ): Promise<PackageDocAnnounce[]> {
    const found: PackageDocAnnounce[] = [];
    for (const used of communityPackagesOf(workflow)) {
      const { installedVersion, rows } = await this.docsOf(used.packageName, instanceId);
      found.push({ ...used, ...(installedVersion ? { installedVersion } : {}), docs: rows.map(summary) });
    }
    return found;
  }

  /**
   * La doc d'un type de nœud telle que l'assistant la lit : un seul document,
   * chaque source sous un titre qui dit d'où elle vient, lu par sections.
   * Un nœud cœur sert la doc n8n du catalogue mutualisé.
   */
  async read(
    nodeType: string,
    options: { instanceId?: string; section?: string; max?: number } = {},
  ): Promise<{ packageName: string; text: string; sources: PackageDocSummary[] } | null> {
    const packageName = nodePackageOf(nodeType) ?? nodeType;
    const max = options.max ?? 6000;
    if (!isCommunityNodeType(nodeType)) {
      const row = await this.prisma.nodeType.findUnique({
        where: { nodeType },
        select: { documentation: true },
      });
      if (!row?.documentation) return null;
      return { packageName, text: readDocSection(row.documentation, options.section, max), sources: [] };
    }

    const { installedVersion, rows } = await this.docsOf(packageName, options.instanceId);
    if (rows.length === 0) return null;
    const document = rows
      .map((row) => {
        const title =
          row.kind === 'manual'
            ? 'Team doc'
            : `README ${row.source}${row.version ? ` ${row.version}` : ''}` +
              (installedVersion && row.version !== installedVersion
                ? ` (installed: ${installedVersion})`
                : '');
        return `# ${title}\n${demoteHeadings(row.content)}`;
      })
      .join('\n\n');
    return { packageName, text: readDocSection(document, options.section, max), sources: rows.map(summary) };
  }

  /** Les paquets du parc et leurs docs, pour la page Catalogue. */
  async list(): Promise<
    Array<{
      packageName: string;
      versions: string[];
      nodeTypes: string[];
      instances: number;
      docs: PackageDocSummary[];
    }>
  > {
    const [uses, rows] = await Promise.all([
      this.packages.inUse(),
      this.prisma.nodePackageDoc.findMany({ orderBy: { fetchedAt: 'desc' } }),
    ]);
    const names = new Set([...uses.map((use) => use.packageName), ...rows.map((row) => row.packageName)]);
    return [...names].sort().map((packageName) => {
      const use = uses.find((entry) => entry.packageName === packageName);
      return {
        packageName,
        versions: use?.versions ?? [],
        nodeTypes: use?.nodeTypes ?? [],
        instances: use?.instanceIds.length ?? 0,
        docs: rows.filter((row) => row.packageName === packageName).map(summary),
      };
    });
  }

  /** Le texte complet d'une doc, pour la relire à l'écran. */
  async content(packageName: string, kind: 'auto' | 'manual'): Promise<string | null> {
    const row = await this.prisma.nodePackageDoc.findFirst({
      where: { packageName, kind },
      orderBy: { fetchedAt: 'desc' },
    });
    return row?.content ?? null;
  }

  /** Enregistre la doc de l'équipe : un texte, ou une URL lue une fois ici. */
  async saveManual(
    packageName: string,
    input: { text?: string; url?: string },
    author?: string,
  ): Promise<PackageDocSummary> {
    const name = packageName.trim();
    if (!name) throw new BadRequestException(msg('analysis.packageNameMissing'));
    const url = input.url?.trim() || undefined;
    let content = input.text?.trim() ?? '';
    if (!content && url) {
      try {
        content = await this.source.fetchDocument(url);
      } catch (error) {
        throw new BadRequestException(
          msg('analysis.packagePageUnreadable', { error: (error as Error).message }),
        );
      }
    }
    if (!content) throw new BadRequestException(msg('analysis.packagePasteTextOrUrl'));
    const data = {
      source: input.text?.trim() ? 'text' : 'url',
      url: url ?? null,
      content: content.slice(0, MAX_MANUAL_CHARS),
      updatedBy: author ?? null,
      fetchedAt: new Date(),
    };
    const key = { packageName: name, kind: 'manual', version: '' };
    const row = await this.prisma.nodePackageDoc.upsert({
      where: { packageName_kind_version: key },
      create: { ...key, ...data },
      update: data,
    });
    return summary(row);
  }

  async deleteManual(packageName: string): Promise<void> {
    await this.prisma.nodePackageDoc.deleteMany({ where: { packageName, kind: 'manual' } });
  }
}
