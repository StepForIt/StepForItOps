import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { WorkflowSyncService } from './workflow-sync.service';

/** Résultat d'une synchro déclenchée par une recherche restée sans résultat. */
export interface SearchSyncReport {
  /** Instances réellement resynchronisées depuis n8n. */
  synced: number;
  /** Instances écartées : déjà synchronisées à l'instant, ou synchro en cours. */
  skipped: number;
  /** Instances injoignables : la recherche se contente du miroir local. */
  failed: number;
}

/**
 * Délai de garde par instance. Une recherche infructueuse est fréquente (faute de
 * frappe, workflow d'une autre instance) et une synchro relit TOUS les workflows :
 * sans ce délai, quelques secondes de frappe suffiraient à en lancer une par lettre.
 */
const COOLDOWN_MS = 60_000;

/**
 * Synchro déclenchée par une recherche sans résultat : un workflow créé dans n8n
 * il y a dix minutes n'est pas encore dans le miroir (cron horaire), et l'utilisateur
 * conclut qu'il n'existe pas au lieu d'aller cliquer « Synchroniser ».
 *
 * Les garde-fous vivent ICI et non dans le navigateur : plusieurs onglets, plusieurs
 * utilisateurs et le rechargement d'une page tapent la même route, et c'est la
 * dernière synchro RÉELLE qui doit décider, pas ce que sait chaque client.
 */
@Injectable()
export class WorkflowSearchSyncService {
  private readonly logger = new Logger(WorkflowSearchSyncService.name);
  /** Dernière tentative par instance, échec compris : une instance HS ne se retente pas en boucle. */
  private readonly lastAttemptAt = new Map<string, number>();
  /** Synchros en cours : deux recherches simultanées n'en lancent qu'une. */
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowSync: WorkflowSyncService,
  ) {}

  /** Synchronise l'instance visée, ou toutes quand la recherche est globale. */
  async syncForSearch(instanceId?: string): Promise<SearchSyncReport> {
    const ids = instanceId
      ? [instanceId]
      : (await this.prisma.instance.findMany({ select: { id: true } })).map((instance) => instance.id);

    const report: SearchSyncReport = { synced: 0, skipped: 0, failed: 0 };
    for (const id of ids) {
      report[await this.syncOne(id)] += 1;
    }
    return report;
  }

  private async syncOne(instanceId: string): Promise<keyof SearchSyncReport> {
    const running = this.running.get(instanceId);
    if (running) {
      // On attend la synchro déjà lancée : la recherche qui suit doit voir son résultat.
      await running.catch(() => undefined);
      return 'skipped';
    }
    if (Date.now() - (this.lastAttemptAt.get(instanceId) ?? 0) < COOLDOWN_MS) return 'skipped';

    this.lastAttemptAt.set(instanceId, Date.now());
    const task = this.workflowSync.syncInstance(instanceId).then(() => undefined);
    this.running.set(instanceId, task);
    try {
      await task;
      return 'synced';
    } catch (error) {
      this.logger.warn(`Search sync failed on ${instanceId}: ${(error as Error).message}`);
      return 'failed';
    } finally {
      this.running.delete(instanceId);
    }
  }
}
