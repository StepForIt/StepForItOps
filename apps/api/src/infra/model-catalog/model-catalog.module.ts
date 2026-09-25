import { Global, Module } from '@nestjs/common';
import { ModelCatalogController } from './model-catalog.controller';
import { ModelCatalogCron } from './model-catalog.cron';
import { ModelCatalogRefreshService } from './model-catalog-refresh.service';
import { ModelCatalogService } from './model-catalog.service';

/**
 * Global : le catalogue des modèles est une donnée de référence, pas une
 * fonctionnalité. `ai-cost` valorise avec, `model-audit` juge avec, l'écran des
 * tarifs l'édite — aucun d'eux n'a à l'importer, et couper l'un ne doit pas
 * éteindre les autres.
 */
@Global()
@Module({
  controllers: [ModelCatalogController],
  providers: [ModelCatalogService, ModelCatalogRefreshService, ModelCatalogCron],
  exports: [ModelCatalogService, ModelCatalogRefreshService],
})
export class ModelCatalogModule {}
