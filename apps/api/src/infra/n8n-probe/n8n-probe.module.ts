import { Global, Module } from '@nestjs/common';
import { N8nProbeService } from './n8n-probe.service';

/** Global : la découverte, le contrôle des tables distantes et la promotion s'en servent sans import croisé. */
@Global()
@Module({
  providers: [N8nProbeService],
  exports: [N8nProbeService],
})
export class N8nProbeModule {}
