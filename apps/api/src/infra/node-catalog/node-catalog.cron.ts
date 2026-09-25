import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NodeCatalogSyncService } from './node-catalog-sync.service';

/**
 * Entretien du catalogue.
 *
 * Hebdomadaire, et non quotidien : l'amont publie au rythme des versions de n8n,
 * et la passe ne télécharge de toute façon rien tant que la révision n'a pas
 * bougé. Les instances sont relues le même jour — un nœud communautaire installé
 * ou une montée de version de n8n change ce que la plateforme doit contrôler.
 *
 * Les instances sans compte n8n sont sautées SANS bruit : elles n'ont pas
 * échoué, elles ont choisi le catalogue mutualisé.
 */
@Injectable()
export class NodeCatalogCron {
  private readonly logger = new Logger(NodeCatalogCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: NodeCatalogSyncService,
  ) {}

  @Cron(CronExpression.EVERY_WEEK)
  async refresh(): Promise<void> {
    try {
      const result = await this.sync.syncCatalog();
      if (result.skipped) this.logger.log('Catalogue déjà à jour.');
    } catch (error) {
      this.logger.warn(`Catalogue non rafraîchi : ${(error as Error).message}`);
    }

    const instances = await this.prisma.instance.findMany({
      where: { n8nEmail: { not: null }, n8nPassword: { not: null } },
      select: { id: true, name: true },
    });
    for (const instance of instances) {
      try {
        await this.sync.syncInstance(instance.id);
      } catch (error) {
        // Une instance injoignable ne doit pas priver les autres de leur passe.
        this.logger.warn(`Types de « ${instance.name} » non relus : ${(error as Error).message}`);
      }
    }
  }
}
