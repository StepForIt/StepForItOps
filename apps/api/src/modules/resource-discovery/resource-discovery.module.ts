import { Module } from '@nestjs/common';
import { InstancesModule } from '../instances/instances.module';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';
import { RESOURCE_DISCOVERY_MANIFEST } from './manifest';
import { ResourceDiscoveryController } from './resource-discovery.controller';
import { ResourceDiscoveryService } from './resource-discovery.service';
import { CredentialHarvesterService } from './credential-harvester.service';
import { WorkflowScannerService } from './workflow-scanner.service';
import { NocoDbLabelsService } from './nocodb-labels.service';

@Module({
  imports: [InstancesModule],
  controllers: [ResourceDiscoveryController],
  providers: [
    ResourceDiscoveryService,
    CredentialHarvesterService,
    WorkflowScannerService,
    NocoDbLabelsService,
    manifestProvider(RESOURCE_DISCOVERY_MANIFEST),
  ],
})
export class ResourceDiscoveryModule {}
