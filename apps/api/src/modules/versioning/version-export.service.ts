import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EVENTS, STORAGE_PORT, StoragePort, VCS_PORT, VcsPort, VersionCreatedEvent, msg } from '@nwm/core';
import { ExportTarget, WorkflowExportRef } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ModuleRegistryService } from '../../infra/modules-registry/module-registry.service';
import { VERSIONING_MANIFEST } from './manifest';
import { driveFileName, githubPath, legacyVersionFileName, versionFileName } from './export-path';
import { isRetiredFromN8n } from './retired-workflow';

/** Ce qui a été écrit dans une cible, pour retrouver le fichier au prochain export. */
interface WrittenFile {
  path: string;
  remoteId?: string | null;
}

interface ExportPayload {
  /** Scope du message de commit : l'historique d'un repo mixte dit qui a bougé. */
  platform: string;
  fileName: string;
  content: string;
  workflowName: string;
  instanceName: string;
  hash: string;
  /** Workflow retiré côté n8n : le fichier va dans `archived/`. */
  archived: boolean;
}

/** Exporte chaque nouvelle version vers les cibles configurées (GitHub / Google Drive). */
@Injectable()
export class VersionExportService {
  private readonly logger = new Logger(VersionExportService.name);
  private exportAllRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ModuleRegistryService,
    @Inject(VCS_PORT) private readonly vcs: VcsPort,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  @OnEvent(EVENTS.versionCreated)
  async onVersionCreated(event: VersionCreatedEvent): Promise<void> {
    if (!(await this.registry.isEnabled(VERSIONING_MANIFEST.id))) return;
    const targets = await this.prisma.exportTarget.findMany({ where: { enabled: true } });
    if (targets.length === 0) return;
    await this.exportVersion(
      event.versionId,
      targets.map((t) => t.id),
    );
  }

  async exportVersion(versionId: string, targetIds?: string[]): Promise<{ exported: string[] }> {
    const version = await this.prisma.workflowVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: { workflow: { include: { instance: true } } },
    });
    const targets = await this.prisma.exportTarget.findMany({
      where: targetIds ? { id: { in: targetIds } } : { enabled: true },
    });

    const { workflow } = version;
    const payload: ExportPayload = {
      platform: workflow.instance.platform,
      fileName: versionFileName(workflow.instance.name, workflow.name, workflow.externalId),
      content: JSON.stringify(version.raw, null, 2),
      workflowName: workflow.name,
      instanceName: workflow.instance.name,
      hash: version.hash,
      archived: isRetiredFromN8n(workflow),
    };
    const refs = await this.prisma.workflowExportRef.findMany({
      where: { workflowId: workflow.id },
    });
    const refByTarget = new Map(refs.map((ref) => [ref.targetId, ref]));
    const exported: string[] = [];

    for (const target of targets) {
      try {
        const ref = refByTarget.get(target.id) ?? null;
        let written: WrittenFile;
        if (target.kind === 'github') {
          written = await this.writeToGithub(target, ref, payload);
        } else if (target.kind === 'gdrive') {
          written = await this.writeToDrive(target, ref, payload);
        } else {
          this.logger.warn(`Target "${target.name}": unknown type "${target.kind}"`);
          continue;
        }
        await this.rememberLocation(workflow.id, target.id, written);
        exported.push(target.name);
      } catch (error) {
        this.logger.warn(`Export "${target.name}" failed: ${(error as Error).message}`);
      }
    }
    if (exported.length > 0) {
      await this.prisma.workflowVersion.update({
        where: { id: versionId },
        data: { exportedAt: new Date(), exportedTo: exported },
      });
    }
    return { exported };
  }

  /**
   * Commit du fichier, puis suppression de son emplacement précédent s'il a
   * changé (workflow renommé) — sinon le repo accumulerait un fichier par nom.
   */
  private async writeToGithub(
    target: ExportTarget,
    ref: WorkflowExportRef | null,
    payload: ExportPayload,
  ): Promise<WrittenFile> {
    const config = target.config as Record<string, string>;
    const vcsConfig = {
      owner: config.owner,
      repo: config.repo,
      branch: config.branch,
      token: config.token || process.env.GITHUB_TOKEN || '',
    };
    const path = githubPath(payload.fileName, payload.archived);
    await this.vcs.commitFile(vcsConfig, {
      path,
      content: payload.content,
      message: `chore(${payload.platform}): ${payload.workflowName} @ ${payload.hash.slice(0, 8)}`,
    });

    // Sans référence connue, l'ancien fichier est celui d'avant le externalId dans le nom.
    const previous =
      ref?.path ?? githubPath(legacyVersionFileName(payload.instanceName, payload.workflowName));
    if (previous !== path) {
      try {
        const { deleted } = await this.vcs.deleteFile(vcsConfig, {
          path: previous,
          message: `chore(${payload.platform}): move ${previous} → ${path}`,
        });
        if (deleted) this.logger.log(`GitHub: ${previous} deleted (moved to ${path})`);
      } catch (error) {
        // Le contenu est écrit : on ne fait pas échouer l'export pour un ménage raté.
        this.logger.warn(`GitHub: deleting ${previous} failed: ${(error as Error).message}`);
      }
    }
    return { path };
  }

  /**
   * Drive n'a pas de chemin : on réécrit le fichier déjà créé (renommage inclus)
   * au lieu d'en empiler un nouveau à chaque export.
   */
  private async writeToDrive(
    target: ExportTarget,
    ref: WorkflowExportRef | null,
    payload: ExportPayload,
  ): Promise<WrittenFile> {
    const config = target.config as Record<string, string>;
    const storageConfig = {
      accessToken: config.accessToken || process.env.GDRIVE_ACCESS_TOKEN || '',
      folderId: config.folderId,
    };
    const name = driveFileName(payload.fileName, payload.archived);

    if (ref?.remoteId) {
      const updated = await this.storage.updateFile(storageConfig, {
        fileId: ref.remoteId,
        name,
        content: payload.content,
        mimeType: 'application/json',
      });
      if (!updated.missing) return { path: name, remoteId: ref.remoteId };
      this.logger.warn(`Drive: file ${ref.remoteId} not found → new upload`);
    }

    const created = await this.storage.uploadFile(storageConfig, {
      name,
      content: payload.content,
      mimeType: 'application/json',
    });
    return { path: name, remoteId: created.id ?? null };
  }

  private async rememberLocation(workflowId: string, targetId: string, written: WrittenFile): Promise<void> {
    await this.prisma.workflowExportRef.upsert({
      where: { workflowId_targetId: { workflowId, targetId } },
      create: { workflowId, targetId, path: written.path, remoteId: written.remoteId ?? null },
      update: { path: written.path, remoteId: written.remoteId ?? null },
    });
  }

  /** Exporte la dernière version de chaque workflow (jamais exportées seulement ; `force` ré-exporte tout). */
  async exportAll(force: boolean): Promise<{ exported: number; skipped: number; failed: number }> {
    // Deux exports simultanés commitent sur la même branche : ils se volent la
    // tête de branche et se répondent 409 l'un l'autre.
    if (this.exportAllRunning) {
      throw new ConflictException(msg('platform.exportAllRunning'));
    }
    this.exportAllRunning = true;
    try {
      return await this.runExportAll(force);
    } finally {
      this.exportAllRunning = false;
    }
  }

  private async runExportAll(force: boolean): Promise<{ exported: number; skipped: number; failed: number }> {
    const targets = await this.prisma.exportTarget.count({ where: { enabled: true } });
    if (targets === 0) {
      throw new BadRequestException(msg('platform.exportNoTarget'));
    }
    const latest = await this.prisma.workflowVersion.findMany({
      distinct: ['workflowId'],
      orderBy: { createdAt: 'desc' },
    });
    let exported = 0;
    let skipped = 0;
    let failed = 0;
    for (const version of latest) {
      if (!force && version.exportedAt) {
        skipped += 1;
        continue;
      }
      try {
        const result = await this.exportVersion(version.id);
        if (result.exported.length > 0) exported += 1;
        else failed += 1;
      } catch (error) {
        this.logger.warn(`Export of version ${version.id} failed: ${(error as Error).message}`);
        failed += 1;
      }
    }
    this.logger.log(`Global export: ${exported} exported, ${skipped} already up to date, ${failed} failures`);
    return { exported, skipped, failed };
  }
}
