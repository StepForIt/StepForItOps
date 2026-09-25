import { Controller, Get, Headers } from '@nestjs/common';
import { DashboardOverview, DashboardService } from './dashboard.service';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';
import { DASHBOARD_MANIFEST } from './manifest';

@ModuleId(DASHBOARD_MANIFEST.id)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** La fenêtre « depuis ta dernière visite » est par utilisateur (x-user-email, posé par le proxy). */
  @Get('overview')
  overview(@Headers('x-user-email') userEmail?: string): Promise<DashboardOverview> {
    return this.dashboard.overview(userEmail);
  }
}
