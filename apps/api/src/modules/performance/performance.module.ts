import { Module } from '@nestjs/common';
import { PerformanceController } from './performance.controller';
import { PerformanceService } from './performance.service';
import { ExecutionStatSamplerService } from './execution-stat-sampler.service';
import { DriftWatchService } from './drift-watch.service';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';
import { PERFORMANCE_MANIFEST } from './manifest';

@Module({
  controllers: [PerformanceController],
  providers: [
    PerformanceService,
    ExecutionStatSamplerService,
    DriftWatchService,
    manifestProvider(PERFORMANCE_MANIFEST),
  ],
})
export class PerformanceModule {}
