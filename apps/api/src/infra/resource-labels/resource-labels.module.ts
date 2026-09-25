import { Global, Module } from '@nestjs/common';
import { ResourceLabelsService } from './resource-labels.service';

/** Global : producteur (resource-discovery) et consommateurs (dep-graph) sans import croisé. */
@Global()
@Module({
  providers: [ResourceLabelsService],
  exports: [ResourceLabelsService],
})
export class ResourceLabelsModule {}
