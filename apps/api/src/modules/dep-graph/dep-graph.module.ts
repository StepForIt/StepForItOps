import { Module } from '@nestjs/common';
import { DepGraphController } from './dep-graph.controller';
import { DepGraphAliasService } from './dep-graph-alias.service';
import { ResourceUsageService } from './resource-usage.service';
import { WorkflowMapController } from './workflow-map.controller';
import { WorkflowMapService } from './workflow-map.service';
import { WorkflowLinksService } from './workflow-links.service';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';
import { DEP_GRAPH_MANIFEST } from './manifest';

@Module({
  controllers: [DepGraphController, WorkflowMapController],
  providers: [
    DepGraphAliasService,
    ResourceUsageService,
    WorkflowMapService,
    WorkflowLinksService,
    manifestProvider(DEP_GRAPH_MANIFEST),
  ],
})
export class DepGraphModule {}
