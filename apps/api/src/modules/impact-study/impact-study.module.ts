import { Module } from '@nestjs/common';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';
import { ImpactContextService } from './impact-context.service';
import { ImpactStudyController } from './impact-study.controller';
import { ImpactStudyService } from './impact-study.service';
import { IMPACT_STUDY_MANIFEST } from './manifest';

@Module({
  controllers: [ImpactStudyController],
  providers: [ImpactContextService, ImpactStudyService, manifestProvider(IMPACT_STUDY_MANIFEST)],
})
export class ImpactStudyModule {}
