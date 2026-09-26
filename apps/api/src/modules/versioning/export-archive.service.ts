import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EVENTS, InstanceSyncedEvent, STORAGE_PORT, StoragePort, VCS_PORT, VcsPort, msg } from '@nwm/core';
import { ExportTarget } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ModuleRegistryService } from '../../infra/modules-registry/module-registry.service';
import { VERSIONING_MANIFEST } from './manifest';
import { exportLocation } from './export-path';
import { isRetiredFromN8n } from './retired-workflow';

export interface ArchiveMove {
  workflowName: string;
  targetName: string;
  from: string;
  to: string;
}

export interface ArchiveReport {
  moved: ArchiveMove[];
  failed: number;
  /** Fichiers exportés inspectés (toutes cibles actives confondues). */
  inspected: number;
}

/**
 * Range les exports au rythme de n8n : un workflow archivé nativement ou
 * supprimé voit son fichier DÉPLACÉ dans `archived/`, et il en ressort si n8n
 * le remet en service.
 *
 * Sans ça l'arbre exporté ne montre jamais que l'accumulation : n8n continue de
 * lister les archivés, donc la synchro les resnapshote et l'export réécrit leur
 * fichier à côté des workflows vivants, indéfiniment ; et un workflow supprimé
 * de n8n y laisse le sien pour toujours, sans que rien ne vienne dire qu'il
 * n'existe plus.
 *
 * Le déplacement se décide sur l'emplacement RÉEL du fichier (`WorkflowExportRef`)
 * et non sur une transition observée à la synchro : les workflows archivés
 * avant l'arrivée de ce rangement n'émettent plus aucune transition, et une
 * passe qui échoue doit pouvoir être rejouée telle quelle.
 */
@Injectable()
export class ExportArchiveService {
  private readonly logger = new Logger(ExportArchiveService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ModuleRegistryService,
    @Inject(VCS_PORT) private readonly vcs: VcsPort,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  @OnEvent(EVENTS.instanceSynced)
  async onInstanceSynced(event: InstanceSyncedEvent): Promise<void> {
    if (!(await this.registry.isEnabled(VERSIONING_MANIFEST.id))) return;
    // Une passe manuelle en cours fait déjà le travail : deux passes simultanées
    // commiteraient sur la même branche et se répondraient 409 l'une l'autre.
    if (this.running) return;
    await this.sweep(event.instanceId);
  }

  /**
   * Passe de rangement, sur une instance ou sur tout le parc (`instanceId`
   * absent) : c'est la reprise du retard — les workflows archivés dans n8n avant
   * l'arrivée de ce rangement n'émettent plus aucune transition.
   */
  async sweep(instanceId?: string): Promise<ArchiveReport> {
    if (this.running) {
      throw new ConflictException(msg('platform.archiveSweepRunning'));
    }
    this.running = true;
    try {
      return await this.reconcile(instanceId);
    } finally {
      this.running = false;
    }
  }

  /** Remet chaque fichier exporté à sa place (actif ou `archived/`). */
  private async reconcile(instanceId?: string): Promise<ArchiveReport> {
    const targets = await this.prisma.exportTarget.findMany({ where: { enabled: true } });
    if (targets.length === 0) return { moved: [], failed: 0, inspected: 0 };
    const targetById = new Map(targets.map((target) => [target.id, target]));

    // Seuls les workflows DÉJÀ exportés sont concernés : on déplace ce qui existe,
    // on ne va pas créer la sauvegarde d'un workflow qui n'en a jamais eu.
    const refs = await this.prisma.workflowExportRef.findMany({
      where: {
        targetId: { in: [...targetById.keys()] },
        ...(instanceId ? { workflow: { instanceId } } : {}),
      },
      include: {
        workflow: { include: { instance: true, versions: { orderBy: { createdAt: 'desc' }, take: 1 } } },
      },
    });

    const moved: ArchiveMove[] = [];
    let failed = 0;

    for (const ref of refs) {
      const target = targetById.get(ref.targetId);
      if (!target) continue;
      const { workflow } = ref;
      const archived = isRetiredFromN8n(workflow);
      const destination = exportLocation(
        target.kind,
        workflow.instance.name,
        workflow.name,
        workflow.externalId,
        archived,
      );
      if (destination === ref.path) continue;

      const content = JSON.stringify(workflow.versions[0]?.raw ?? workflow.raw, null, 2);
      try {
        const remoteId = await this.move(target, ref.path, ref.remoteId, destination, content, {
          archived,
          platform: workflow.instance.platform,
        });
        await this.prisma.workflowExportRef.update({
          where: { id: ref.id },
          data: { path: destination, remoteId },
        });
        moved.push({
          workflowName: workflow.name,
          targetName: target.name,
          from: ref.path,
          to: destination,
        });
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `Moving "${workflow.name}" to ${destination} (${target.name}) failed: ${(error as Error).message}`,
        );
      }
    }

    if (moved.length > 0 || failed > 0) {
      this.logger.log(
        `Exports sorted (${instanceId ?? 'all instances'}): ${refs.length} file(s) inspected, ` +
          `${moved.length} moved, ${failed} failure(s)`,
      );
    }
    return { moved, failed, inspected: refs.length };
  }

  /** Écrit à la nouvelle place puis retire l'ancienne — jamais l'inverse. */
  private async move(
    target: ExportTarget,
    from: string,
    remoteId: string | null,
    to: string,
    content: string,
    { archived, platform }: { archived: boolean; platform: string },
  ): Promise<string | null> {
    const message = archived
      ? `chore(${platform}): archive ${from} → ${to}`
      : `chore(${platform}): reactivate ${from} → ${to}`;

    if (target.kind === 'github') {
      const config = this.vcsConfig(target);
      await this.vcs.commitFile(config, { path: to, content, message });
      try {
        await this.vcs.deleteFile(config, { path: from, message });
      } catch (error) {
        // Le fichier est en sécurité à sa nouvelle place : un ménage raté ne
        // doit pas rejouer l'écriture au prochain passage.
        this.logger.warn(`GitHub: deleting ${from} failed: ${(error as Error).message}`);
      }
      return null;
    }

    // Drive est plat : le « dossier » est un préfixe du nom, donc renommer suffit.
    const config = this.storageConfig(target);
    if (remoteId) {
      const updated = await this.storage.updateFile(config, {
        fileId: remoteId,
        name: to,
        content,
        mimeType: 'application/json',
      });
      if (!updated.missing) return remoteId;
      this.logger.warn(`Drive: file ${remoteId} not found → new upload`);
    }
    const created = await this.storage.uploadFile(config, {
      name: to,
      content,
      mimeType: 'application/json',
    });
    return created.id ?? null;
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
