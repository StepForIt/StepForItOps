import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ModelCatalogRefreshService } from './model-catalog-refresh.service';

/**
 * Entretien du catalogue des modèles.
 *
 * Hebdomadaire, au même rythme que le catalogue de nœuds : les modèles sortent
 * au rythme des providers, et la passe ne télécharge de toute façon rien tant
 * que la révision amont n'a pas bougé. Elle ne fait que PROPOSER — l'écriture
 * reste un clic humain.
 */
@Injectable()
export class ModelCatalogCron {
  private readonly logger = new Logger(ModelCatalogCron.name);

  constructor(private readonly refresh: ModelCatalogRefreshService) {}

  @Cron(CronExpression.EVERY_WEEK)
  async tick(): Promise<void> {
    try {
      const result = await this.refresh.refreshFromSource();
      if (result.proposed > 0) {
        this.logger.log(`Model catalog: ${result.proposed} proposal(s) to review.`);
      }
    } catch (error) {
      // Un amont injoignable n'est pas une panne d'ici : le catalogue local
      // continue de servir, et sa fraîcheur le dit à l'écran.
      this.logger.warn(`Model catalog not refreshed: ${(error as Error).message}`);
    }
    await this.refresh.refreshFromAi();
  }
}
