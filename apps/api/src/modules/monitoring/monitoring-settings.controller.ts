import { Body, Controller, Delete, Get, Post, Put } from '@nestjs/common';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';
import {
  KumaSettingsInput,
  KumaSettingsView,
  MonitoringSettingsService,
} from './monitoring-settings.service';

/** Réglages Uptime Kuma (stockés en DB, prioritaires sur les variables d'env). */
@ModuleId('monitoring')
@Controller('monitoring/settings/kuma')
export class MonitoringSettingsController {
  constructor(private readonly settings: MonitoringSettingsService) {}

  @Get()
  get(): Promise<KumaSettingsView> {
    return this.settings.get();
  }

  @Put()
  save(@Body() body: KumaSettingsInput): Promise<KumaSettingsView> {
    return this.settings.save(body);
  }

  @Delete()
  clear(): Promise<KumaSettingsView> {
    return this.settings.clear();
  }

  @Post('test')
  test(@Body() body?: KumaSettingsInput): Promise<{ ok: true }> {
    return this.settings.test(body);
  }
}
