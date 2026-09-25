import { Module } from '@nestjs/common';
import { AuthSettingsController } from './auth-settings.controller';
import { AuthSettingsService } from './auth-settings.service';

@Module({
  controllers: [AuthSettingsController],
  providers: [AuthSettingsService],
})
export class AuthSettingsModule {}
