import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';
import { CredentialHarvesterService, HarvestedCredential } from './credential-harvester.service';
import { DiscoverInput, DiscoveryLeftover, ResourceDiscoveryService } from './resource-discovery.service';
import { NocoDbEndpoint, NocoDbLabelsService, NocoDbRefreshResult } from './nocodb-labels.service';
import { GroupScanResult, WorkflowScannerService, WorkflowScanResult } from './workflow-scanner.service';
import { DISCOVERY_PROVIDERS, DiscoveredItem } from './provider-catalog';

export interface ProviderCatalogEntry {
  provider: string;
  credentialTypes: string[];
  needsHost: boolean;
  steps: Array<{ id: string; label: string; parentStepId?: string }>;
}

@ModuleId('resource-discovery')
@Controller('resource-discovery')
export class ResourceDiscoveryController {
  constructor(
    private readonly harvester: CredentialHarvesterService,
    private readonly discovery: ResourceDiscoveryService,
    private readonly scanner: WorkflowScannerService,
    private readonly nocodb: NocoDbLabelsService,
  ) {}

  /** Providers découvrables et leurs étapes (bases → tables…). */
  @Get('providers')
  providers(): ProviderCatalogEntry[] {
    return DISCOVERY_PROVIDERS.map(({ provider, credentialTypes, needsHost, steps }) => ({
      provider,
      credentialTypes,
      needsHost: needsHost ?? false,
      steps: steps
        .filter((s) => !s.internal)
        .map((s) => ({ id: s.id, label: s.label, parentStepId: s.parentStepId })),
    }));
  }

  /** Credentials NocoDB vus dans les workflows, avec le host déjà renseigné. */
  @Get('nocodb/endpoints')
  nocodbEndpoints(@Query('instanceId') instanceId?: string): Promise<NocoDbEndpoint[]> {
    return this.nocodb.endpoints(instanceId);
  }

  /** L'URL de l'API NocoDB vit dans le credential : elle se saisit ici, une fois. */
  @Put('nocodb/endpoints')
  setNocodbHost(@Body() body: { credentialId?: string; host?: string }): Promise<NocoDbEndpoint | undefined> {
    if (!body.credentialId || !body.host?.trim()) {
      throw new BadRequestException('credentialId et host sont requis');
    }
    return this.nocodb.setHost(body.credentialId, body.host);
  }

  /** Redécouvre les vrais noms des bases/tables NocoDB et les met en cache. */
  @Post('nocodb/refresh-labels')
  refreshNocodbLabels(@Body() body: { instanceId?: string }): Promise<NocoDbRefreshResult> {
    if (!body.instanceId) throw new BadRequestException('instanceId est requis');
    return this.nocodb.refresh(body.instanceId);
  }

  /** Credentials récoltés dans les workflows snapshotés (l'API n8n ne les liste pas). */
  @Get('credentials')
  credentials(
    @Query('instanceId') instanceId?: string,
    @Query('provider') provider?: string,
    @Query('groupId') groupId?: string,
  ): Promise<HarvestedCredential[]> {
    return this.harvester.harvest({ instanceId, provider, groupId });
  }

  @Post('discover')
  discover(@Body() body: DiscoverInput): Promise<{ items: DiscoveredItem[] }> {
    return this.discovery.discover(body);
  }

  /** Workflows temporaires restés sur l'instance (échec conservé pour debug). */
  @Get('leftovers')
  leftovers(@Query('instanceId') instanceId?: string): Promise<DiscoveryLeftover[]> {
    if (!instanceId) throw new BadRequestException('instanceId est requis');
    return this.discovery.leftovers(instanceId);
  }

  @Delete('leftovers/:externalId')
  async deleteLeftover(
    @Param('externalId') externalId: string,
    @Query('instanceId') instanceId?: string,
  ): Promise<{ deleted: string }> {
    if (!instanceId) throw new BadRequestException('instanceId est requis');
    await this.discovery.deleteLeftover(instanceId, externalId);
    return { deleted: externalId };
  }

  /** Ressources + credentials référencés par un workflow, croisés avec les mappings existants. */
  @Get('workflow-scan')
  scanWorkflow(@Query('workflowId') workflowId: string): Promise<WorkflowScanResult> {
    return this.scanner.scan(workflowId);
  }

  /** Même scan, agrégé sur tous les workflows d'un groupe. */
  @Get('group-scan')
  scanGroup(@Query('groupId') groupId: string): Promise<GroupScanResult> {
    return this.scanner.scanGroup(groupId);
  }
}
