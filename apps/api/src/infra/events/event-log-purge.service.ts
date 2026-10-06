import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/** Au-delà, une ligne du journal n'apprend plus rien à personne. */
export const EVENT_LOG_RETENTION_DAYS = 30;

/**
 * Purge quotidienne du journal d'événements.
 *
 * Il n'avait aucune rétention : une synchro horaire y ajoutait une ligne par
 * workflow, indéfiniment. On garde toujours la DERNIÈRE ligne de chaque nom,
 * si vieille soit-elle : ops-cloud lit la date du dernier `instance.synced`
 * pour dire depuis quand le miroir n'a plus bougé, et une purge qui l'effaçait
 * transformerait « muet depuis 40 jours » en « jamais synchronisé ».
 */
@Injectable()
export class EventLogPurgeService {
  private readonly logger = new Logger(EventLogPurgeService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async tick(): Promise<void> {
    try {
      const removed = await this.purge();
      if (removed > 0)
        this.logger.log(`Event log: ${removed} row(s) older than ${EVENT_LOG_RETENTION_DAYS} days purged.`);
    } catch (error) {
      this.logger.warn(`Event log not purged: ${(error as Error).message}`);
    }
  }

  async purge(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - EVENT_LOG_RETENTION_DAYS * 24 * 3600 * 1000);
    return this.prisma.$executeRaw`
      DELETE FROM "EventLog" e
      WHERE e."createdAt" < ${cutoff}
        AND EXISTS (
          SELECT 1 FROM "EventLog" n
          WHERE n."name" = e."name" AND n."createdAt" > e."createdAt"
        )`;
  }
}
