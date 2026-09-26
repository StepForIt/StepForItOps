import { Injectable } from '@nestjs/common';
import { BlueprintAccountRef, N8nNode, N8nWorkflow, PlatformId, diffBlueprints, msg } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { exportLocation, githubPath, legacyVersionFileName, versionFileName } from './export-path';
import { isRetiredFromN8n } from './retired-workflow';

/** Ce que la restauration va écraser sur la plateforme du workflow. */
export interface RestorePreview {
  versionId: string;
  platform: PlatformId;
  hash: string;
  createdAt: Date;
  origin: string;
  message: string | null;
  workflow: { id: string; name: string; externalId: string; active: boolean; syncedAt: Date };
  instance: { id: string; name: string; baseUrl: string };
  /** La version est-elle déjà l'état connu du workflow (restauration sans effet) ? */
  identicalToCurrent: boolean;
  /** Version la plus récente du workflow en base ? */
  isLatest: boolean;
  /** Nombre de versions créées après celle-ci (ce qu'on « remonte »). */
  versionsAfter: number;
  /** Workflow archivé côté n8n : le PUT sera refusé. Toujours faux chez Make, qui n'archive pas. */
  archived: boolean;
  /** Le nom du workflow change aussi (l'écriture remet le nom de la version). */
  renameTo: string | null;
  /** Nœuds n8n ou modules Make : le mot change, pas le calcul. */
  nodes: { current: number; restored: number; added: string[]; removed: string[]; modified: string[] };
  /** Différences hors nœuds (le hash peut changer sans qu'aucun nœud ne bouge). */
  otherChanges: { connections: boolean; settings: boolean };
  /** Ce que la plateforme ne restaurera pas, ou pourrait refuser — à lire avant de confirmer. */
  notes: string[];
}

type ContentImpact = Pick<RestorePreview, 'archived' | 'renameTo' | 'nodes' | 'otherChanges' | 'notes'>;

/** Où part le JSON de la version et ce que ça touche. */
export interface ExportPreview {
  versionId: string;
  hash: string;
  workflowName: string;
  instanceName: string;
  /** Chemin relatif du fichier (préfixé `workflows/` sur GitHub). */
  fileName: string;
  sizeBytes: number;
  alreadyExported: { at: Date; to: string[] } | null;
  targets: Array<{
    id: string;
    name: string;
    kind: string;
    destination: string;
    /** Emplacement précédent : le fichier sera déplacé, pas dupliqué. */
    movedFrom: string | null;
  }>;
}

function nodesOf(raw: unknown): N8nNode[] {
  const nodes = (raw as N8nWorkflow | null)?.nodes;
  return Array.isArray(nodes) ? nodes : [];
}

function byName(nodes: N8nNode[]): Map<string, N8nNode> {
  return new Map(nodes.map((node) => [node.name, node]));
}

function n8nImpact(currentValue: unknown, restoredValue: unknown, currentName: string): ContentImpact {
  const current = byName(nodesOf(currentValue));
  const restored = byName(nodesOf(restoredValue));
  const currentRaw = currentValue as N8nWorkflow | null;
  const restoredRaw = restoredValue as N8nWorkflow | null;
  const restoredName = restoredRaw?.name;
  return {
    archived: currentRaw?.isArchived === true,
    renameTo: restoredName && restoredName !== currentName ? restoredName : null,
    nodes: {
      current: current.size,
      restored: restored.size,
      added: [...restored.keys()].filter((name) => !current.has(name)),
      removed: [...current.keys()].filter((name) => !restored.has(name)),
      modified: [...restored.entries()]
        .filter(([name, node]) => {
          const before = current.get(name);
          return before !== undefined && JSON.stringify(before) !== JSON.stringify(node);
        })
        .map(([name]) => name),
    },
    otherChanges: {
      connections:
        JSON.stringify(currentRaw?.connections ?? {}) !== JSON.stringify(restoredRaw?.connections ?? {}),
      settings: JSON.stringify(currentRaw?.settings ?? {}) !== JSON.stringify(restoredRaw?.settings ?? {}),
    },
    notes: [],
  };
}

function makeImpact(currentValue: unknown, restoredValue: unknown, currentName: string): ContentImpact {
  const diff = diffBlueprints(currentValue, restoredValue);
  const restoredName = (restoredValue as { name?: unknown } | null)?.name;
  const notes = [msg('platform.restoreMakeSchedule')];
  if (diff.refsOnlyInRestored.length > 0) {
    notes.push(
      msg('platform.restoreMakeRefsGone', { refs: diff.refsOnlyInRestored.map(describeRef).join(', ') }),
    );
  }
  return {
    archived: false,
    renameTo: typeof restoredName === 'string' && restoredName !== currentName ? restoredName : null,
    nodes: diff.modules,
    otherChanges: { connections: diff.structureChanged, settings: diff.settingsChanged },
    notes,
  };
}

function describeRef(ref: BlueprintAccountRef): string {
  const kind = ref.key === '__IMTCONN__' ? 'connection' : ref.key === '__IMTHOOK__' ? 'webhook' : 'other';
  return msg('platform.restoreMakeRef', { kind, key: ref.key, id: ref.id, module: ref.module });
}

@Injectable()
export class VersionPreviewService {
  constructor(private readonly prisma: PrismaService) {}

  async restorePreview(versionId: string): Promise<RestorePreview> {
    const version = await this.prisma.workflowVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: { workflow: { include: { instance: true } } },
    });
    const { workflow } = version;

    const [versionsAfter, newer] = await Promise.all([
      this.prisma.workflowVersion.count({
        where: { workflowId: workflow.id, createdAt: { gt: version.createdAt } },
      }),
      this.prisma.workflowVersion.findFirst({
        where: { workflowId: workflow.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      }),
    ]);

    const platform = workflow.instance.platform as PlatformId;
    const impact =
      platform === 'make'
        ? makeImpact(workflow.raw, version.raw, workflow.name)
        : n8nImpact(workflow.raw, version.raw, workflow.name);

    return {
      versionId: version.id,
      platform,
      hash: version.hash,
      createdAt: version.createdAt,
      origin: version.origin,
      message: version.message,
      workflow: {
        id: workflow.id,
        name: workflow.name,
        externalId: workflow.externalId,
        active: workflow.active,
        syncedAt: workflow.updatedAt,
      },
      instance: {
        id: workflow.instance.id,
        name: workflow.instance.name,
        baseUrl: workflow.instance.baseUrl,
      },
      identicalToCurrent: version.hash === workflow.hash,
      isLatest: newer?.id === version.id,
      versionsAfter,
      ...impact,
    };
  }

  async exportPreview(versionId: string): Promise<ExportPreview> {
    const version = await this.prisma.workflowVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: { workflow: { include: { instance: true } } },
    });
    const targets = await this.prisma.exportTarget.findMany({ where: { enabled: true } });
    const { workflow } = version;
    const fileName = versionFileName(workflow.instance.name, workflow.name, workflow.externalId);
    const refs = await this.prisma.workflowExportRef.findMany({
      where: { workflowId: workflow.id },
    });
    const refByTarget = new Map(refs.map((ref) => [ref.targetId, ref]));

    return {
      versionId: version.id,
      hash: version.hash,
      workflowName: workflow.name,
      instanceName: workflow.instance.name,
      fileName,
      sizeBytes: Buffer.byteLength(JSON.stringify(version.raw, null, 2)),
      alreadyExported: version.exportedAt ? { at: version.exportedAt, to: version.exportedTo } : null,
      targets: targets.map((target) => {
        const config = target.config as Record<string, string>;
        const isGithub = target.kind === 'github';
        const path = exportLocation(
          target.kind,
          workflow.instance.name,
          workflow.name,
          workflow.externalId,
          isRetiredFromN8n(workflow),
        );
        // Sans référence connue, seul GitHub a un ancien chemin déductible (nom sans externalId).
        const previous =
          refByTarget.get(target.id)?.path ??
          (isGithub ? githubPath(legacyVersionFileName(workflow.instance.name, workflow.name)) : null);
        return {
          id: target.id,
          name: target.name,
          kind: target.kind,
          destination: isGithub
            ? `${config.owner}/${config.repo}@${config.branch || 'main'} → ${path}`
            : msg('platform.exportDriveDestination', {
                hasFolder: !!config.folderId,
                folderId: config.folderId ?? '',
                path,
              }),
          movedFrom: previous && previous !== path ? previous : null,
        };
      }),
    };
  }
}
