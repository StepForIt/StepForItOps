import { Global, Module } from '@nestjs/common';
import { NodeCatalogController } from './node-catalog.controller';
import { NodeCatalogCron } from './node-catalog.cron';
import { NodeCatalogService } from './node-catalog.service';
import { NodeCatalogSyncService } from './node-catalog-sync.service';
import { CommunityPackagesService } from './community-packages.service';
import { NodePackageDocsService } from './node-package-docs.service';
import { NodePackageDocsSyncService } from './node-package-docs-sync.service';

/**
 * Global : le catalogue est une donnée de référence, pas une fonctionnalité. Le
 * `verifier` s'en sert pour ses contrôles, l'assistant pour ses outils, l'écran
 * des instances pour son état — aucun d'eux n'a à l'importer.
 */
@Global()
@Module({
  controllers: [NodeCatalogController],
  providers: [
    NodeCatalogService,
    NodeCatalogSyncService,
    NodeCatalogCron,
    CommunityPackagesService,
    NodePackageDocsService,
    NodePackageDocsSyncService,
  ],
  exports: [NodeCatalogService, NodeCatalogSyncService, NodePackageDocsService, NodePackageDocsSyncService],
})
export class NodeCatalogModule {}
