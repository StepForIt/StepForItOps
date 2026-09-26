import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { WorkflowSyncService } from './workflow-sync.service';

/**
 * Resynchronisation périodique de toutes les instances.
 *
 * Sans elle, le miroir local ne bouge qu'au clic sur « Synchroniser » : un
 * workflow créé, renommé, archivé ou supprimé dans n8n reste invisible — ou pire,
 * affiché tel qu'il était il y a trois semaines. Les instances sont traitées
 * l'une après l'autre : une injoignable ne doit pas priver les autres de synchro.
 */
@Injectable()
export class WorkflowSyncCron {
  private readonly logger = new Logger(WorkflowSyncCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: WorkflowSyncService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async syncAll(): Promise<void> {
    const instances = await this.prisma.instance.findMany({ select: { id: true, name: true } });
    for (const instance of instances) {
      try {
        await this.sync.syncInstance(instance.id);
      } catch (error) {
        this.logger.warn(`Sync of "${instance.name}" failed: ${(error as Error).message}`);
      }
    }
  }
}
