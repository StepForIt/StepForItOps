import { Body, Controller, Get, Put } from '@nestjs/common';
import {
  PlatformSettingsInput,
  PlatformSettingsService,
  PlatformSettingsView,
} from '../../infra/settings/platform-settings.service';

/** Réglages transverses (workflows archivés…), édités depuis la page Modules. */
@Controller('settings/platform')
export class PlatformSettingsController {
  constructor(private readonly settings: PlatformSettingsService) {}

  @Get()
  get(): Promise<PlatformSettingsView> {
    return this.settings.get();
  }

  @Put()
  save(@Body() body: PlatformSettingsInput): Promise<PlatformSettingsView> {
    return this.settings.save(body);
  }
}
