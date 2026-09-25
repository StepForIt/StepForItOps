import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { NodeCatalogService } from './node-catalog.service';
import { NodeCatalogSyncService } from './node-catalog-sync.service';

/**
 * Le catalogue vu de l'UI : son état, sa mise à jour, et la consultation d'un
 * type de nœud. Pas de module métier — le catalogue est de l'infrastructure,
 * comme les réglages de plateforme : `verifier`, `workflow-chat` et l'écran des
 * instances s'en servent tous, et aucun d'eux ne le possède.
 */
@Controller('node-catalog')
export class NodeCatalogController {
  constructor(
    private readonly catalog: NodeCatalogService,
    private readonly sync: NodeCatalogSyncService,
  ) {}

  @Get('status')
  async status() {
    return this.sync.status();
  }

  @Post('sync')
  async syncCatalog(@Body() body: { force?: boolean; includeCommunity?: boolean } = {}) {
    return this.sync.syncCatalog({ force: body.force, includeCommunity: body.includeCommunity });
  }

  @Post('sync/:instanceId')
  async syncInstance(@Param('instanceId') instanceId: string) {
    return this.sync.syncInstance(instanceId);
  }

  @Get('search')
  async search(@Query('q') query?: string) {
    return this.catalog.search(query ?? '');
  }

  @Get('types/:nodeType')
  async describe(@Param('nodeType') nodeType: string, @Query('instanceId') instanceId?: string) {
    const description = await this.catalog.describe(nodeType, instanceId);
    if (!description) throw new BadRequestException(`Type « ${nodeType} » absent du catalogue`);
    return description;
  }
}
