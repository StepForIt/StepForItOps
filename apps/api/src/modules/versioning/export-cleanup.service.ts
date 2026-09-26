import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { STORAGE_PORT, StoragePort, VCS_PORT, VcsPort, msg } from '@nwm/core';
import { ExportTarget } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { GITHUB_EXPORT_ROOT, exportLocation, n8nIdFromFileName } from './export-path';
import { isRetiredFromN8n } from './retired-workflow';

/**
 * `ok`        : fichier au bon emplacement, on n'y touche pas.
 * `duplicate` : ancien emplacement d'un workflow dont le fichier à jour existe → supprimable.
 * `pending`   : ancien emplacement, mais le fichier au nouveau format n'existe pas encore
 *               → il faut ré-exporter avant de supprimer (sinon on perd la sauvegarde).
 * `unknown`   : aucun workflow connu derrière ce fichier (supprimé de n8n ?) → conservé.
 */
export type CleanupStatus = 'ok' | 'duplicate' | 'pending' | 'unknown';

export interface CleanupEntry {
  /** Chemin (GitHub) ou nom de fichier (Drive). */
  path: string;
  /** Identifiant du fichier côté Drive. */
  remoteId?: string;
  status: CleanupStatus;
  /** externalId retrouvé, via le nom de fichier ou le JSON lui-même. */
  externalId: string | null;
  /** Nom du workflow correspondant en base, si connu. */
  workflowName: string | null;
  /** Emplacement à jour attendu pour ce workflow. */
  expectedPath: string | null;
  reason: string;
}

export interface CleanupReport {
  targetId: string;
  targetName: string;
  kind: string;
  /** Fichiers trouvés dans la cible. */
  total: number;
  ok: number;
  entries: CleanupEntry[];
  /** Fichiers effectivement supprimés (uniquement sur `apply`). */
  deleted?: string[];
}

interface RemoteFile {
  path: string;
  remoteId?: string;
}

interface KnownWorkflow {
  name: string;
  expectedPath: string;
}

/**
 * Repère et supprime les fichiers laissés par les renommages (exports d'avant
 * l'identification par externalId). Lecture seule tant qu'on n'appelle pas `apply`.
 */
@Injectable()
export class ExportCleanupService {
  private readonly logger = new Logger(ExportCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(VCS_PORT) private readonly vcs: VcsPort,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  async preview(targetId: string): Promise<CleanupReport> {
    return this.run(targetId, false);
  }

  async apply(targetId: string): Promise<CleanupReport> {
    return this.run(targetId, true);
  }

  private async run(targetId: string, destructive: boolean): Promise<CleanupReport> {
    const target = await this.prisma.exportTarget.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException(msg('platform.cleanupTargetNotFound', { id: targetId }));

    const known = await this.knownWorkflows(target.kind);
    const files = await this.listFiles(target);
    const present = new Set(files.map((file) => file.path));
    const entries: CleanupEntry[] = [];

    for (const file of files) {
      entries.push(await this.classify(target, file, known, present));
    }

    const report: CleanupReport = {
      targetId: target.id,
      targetName: target.name,
      kind: target.kind,
      total: files.length,
      ok: entries.filter((entry) => entry.status === 'ok').length,
      entries: entries.filter((entry) => entry.status !== 'ok'),
    };

    if (destructive) {
      report.deleted = await this.deleteAll(
        target,
        entries.filter((entry) => entry.status === 'duplicate'),
      );
    }
    return report;
  }

  /** externalId → nom + emplacement attendu, pour tous les workflows connus. */
  private async knownWorkflows(kind: string): Promise<Map<string, KnownWorkflow>> {
    const workflows = await this.prisma.workflow.findMany({ include: { instance: true } });
    return new Map(
      workflows.map((workflow) => [
        workflow.externalId,
        {
          name: workflow.name,
          // Un workflow retiré côté n8n est attendu dans `archived/` : l'y voir
          // n'est pas un doublon à supprimer, c'est son rangement.
          expectedPath: exportLocation(
            kind,
            workflow.instance.name,
            workflow.name,
            workflow.externalId,
            isRetiredFromN8n(workflow),
          ),
        },
      ]),
    );
  }

  private async listFiles(target: ExportTarget): Promise<RemoteFile[]> {
    if (target.kind === 'github') {
      const paths = await this.vcs.listFiles(this.vcsConfig(target), {
        path: GITHUB_EXPORT_ROOT,
      });
      return paths.filter((path) => path.endsWith('.json')).map((path) => ({ path }));
    }
    const files = await this.storage.listFiles(this.storageConfig(target));
    return files
      .filter((file) => file.name.endsWith('.json'))
      .map((file) => ({ path: file.name, remoteId: file.id }));
  }

  private async classify(
    target: ExportTarget,
    file: RemoteFile,
    known: Map<string, KnownWorkflow>,
    present: Set<string>,
  ): Promise<CleanupEntry> {
    const base: CleanupEntry = {
      path: file.path,
      remoteId: file.remoteId,
      status: 'unknown',
      externalId: null,
      workflowName: null,
      expectedPath: null,
      reason: '',
    };

    // Nouveau format : le externalId est dans le nom du fichier.
    const idFromName = n8nIdFromFileName(file.path);
    if (idFromName) {
      const workflow = known.get(idFromName);
      if (!workflow) {
        return {
          ...base,
          externalId: idFromName,
          reason: msg('platform.cleanupNoWorkflow'),
        };
      }
      if (workflow.expectedPath === file.path) {
        return { ...base, status: 'ok', externalId: idFromName, workflowName: workflow.name };
      }
      // Emplacement dépassé : renommage, ou workflow depuis retiré côté n8n
      // (son fichier est attendu dans `archived/`). On ne supprime que si la
      // copie à jour existe déjà — sinon c'est la seule qui reste.
      const moved = present.has(workflow.expectedPath);
      return {
        ...base,
        status: moved ? 'duplicate' : 'pending',
        externalId: idFromName,
        workflowName: workflow.name,
        expectedPath: workflow.expectedPath,
        reason: moved
          ? msg('platform.cleanupStaleLocationReady')
          : msg('platform.cleanupStaleLocationReexport'),
      };
    }

    // Ancien format : le seul moyen fiable de savoir à qui il appartient est son contenu.
    const id = await this.n8nIdFromContent(target, file);
    if (!id) {
      return { ...base, reason: msg('platform.cleanupUnknownFormat') };
    }
    const workflow = known.get(id);
    if (!workflow) {
      return {
        ...base,
        externalId: id,
        reason: msg('platform.cleanupNoWorkflow'),
      };
    }
    const upToDateExists = present.has(workflow.expectedPath);
    return {
      ...base,
      status: upToDateExists ? 'duplicate' : 'pending',
      externalId: id,
      workflowName: workflow.name,
      expectedPath: workflow.expectedPath,
      reason: upToDateExists
        ? msg('platform.cleanupOldFormatReady')
        : msg('platform.cleanupOldFormatReexport'),
    };
  }

  private async n8nIdFromContent(target: ExportTarget, file: RemoteFile): Promise<string | null> {
    const content =
      target.kind === 'github'
        ? await this.vcs.readFile(this.vcsConfig(target), { path: file.path })
        : file.remoteId
          ? await this.storage.readFile(this.storageConfig(target), { fileId: file.remoteId })
          : null;
    if (!content) return null;
    try {
      const id = (JSON.parse(content) as { id?: unknown }).id;
      return typeof id === 'string' && id.length > 0 ? id : null;
    } catch {
      return null;
    }
  }

  private async deleteAll(target: ExportTarget, entries: CleanupEntry[]): Promise<string[]> {
    const deleted: string[] = [];
    for (const entry of entries) {
      try {
        if (target.kind === 'github') {
          const result = await this.vcs.deleteFile(this.vcsConfig(target), {
            path: entry.path,
            message: `chore(export): delete duplicate ${entry.path}`,
          });
          if (result.deleted) deleted.push(entry.path);
        } else if (entry.remoteId) {
          const result = await this.storage.deleteFile(this.storageConfig(target), {
            fileId: entry.remoteId,
          });
          if (result.deleted) deleted.push(entry.path);
        }
      } catch (error) {
        this.logger.warn(`Deleting ${entry.path} failed: ${(error as Error).message}`);
      }
    }
    this.logger.log(`Cleanup "${target.name}": ${deleted.length} file(s) deleted`);
    return deleted;
  }

  private vcsConfig(target: ExportTarget) {
    const config = target.config as Record<string, string>;
    return {
      owner: config.owner,
      repo: config.repo,
      branch: config.branch,
      token: config.token || process.env.GITHUB_TOKEN || '',
    };
  }

  private storageConfig(target: ExportTarget) {
    const config = target.config as Record<string, string>;
    return {
      accessToken: config.accessToken || process.env.GDRIVE_ACCESS_TOKEN || '',
      folderId: config.folderId,
    };
  }
}
