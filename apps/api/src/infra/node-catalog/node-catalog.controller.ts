import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { msg } from '@nwm/core';
import { NodeCatalogService } from './node-catalog.service';
import { NodeCatalogSyncService } from './node-catalog-sync.service';
import { NodePackageDocsService } from './node-package-docs.service';
import { NodePackageDocsSyncService } from './node-package-docs-sync.service';

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
    private readonly packageDocs: NodePackageDocsService,
    private readonly packageDocsSync: NodePackageDocsSyncService,
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
    if (!description) throw new BadRequestException(msg('analysis.nodeTypeNotInCatalog', { type: nodeType }));
    return description;
  }

  // Un nom de paquet scopé porte un `/` : il voyage en paramètre de requête, pas dans le chemin.

  @Get('packages')
  async packages() {
    return this.packageDocs.list();
  }

  @Post('packages/refresh')
  async refreshPackages(@Body() body: { packageName?: string } = {}) {
    if (body.packageName) {
      return { [await this.packageDocsSync.refreshPackage(body.packageName, [], { force: true })]: 1 };
    }
    return this.packageDocsSync.refreshAll({ force: true });
  }

  @Get('packages/doc')
  async packageDoc(@Query('name') name?: string, @Query('kind') kind?: string) {
    if (!name) throw new BadRequestException(msg('analysis.packageMissing'));
    const content = await this.packageDocs.content(name, kind === 'manual' ? 'manual' : 'auto');
    if (content === null) throw new NotFoundException(msg('analysis.packageNoDoc', { name }));
    return { content };
  }

  @Put('packages/doc')
  async saveManual(
    @Body() body: { packageName?: string; text?: string; url?: string },
    @Headers('x-user-email') email?: string,
  ) {
    return this.packageDocs.saveManual(body.packageName ?? '', body, email);
  }

  @Delete('packages/doc')
  async deleteManual(@Query('name') name?: string) {
    if (!name) throw new BadRequestException(msg('analysis.packageMissing'));
    await this.packageDocs.deleteManual(name);
    return { deleted: true };
  }
}
