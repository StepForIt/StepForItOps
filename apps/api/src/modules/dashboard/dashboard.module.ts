import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';
import { DASHBOARD_MANIFEST } from './manifest';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, manifestProvider(DASHBOARD_MANIFEST)],
})
export class DashboardModule {}
