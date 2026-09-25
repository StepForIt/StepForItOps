import { Module } from '@nestjs/common';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';
import { RELEASE_PROCEDURES_MANIFEST } from './manifest';
import { ReleaseProceduresController } from './release-procedures.controller';
import { ReleaseProceduresService } from './release-procedures.service';

@Module({
  controllers: [ReleaseProceduresController],
  providers: [ReleaseProceduresService, manifestProvider(RELEASE_PROCEDURES_MANIFEST)],
})
export class ReleaseProceduresModule {}
