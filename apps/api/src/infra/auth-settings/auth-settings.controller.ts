import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { msg } from '@nwm/core';
import { AuthBootstrapView, AuthSettingsService } from './auth-settings.service';

const MIN_PASSWORD_LENGTH = 10;

export interface BootstrapBody {
  username?: string;
  password?: string;
}

/**
 * Routes serveur-à-serveur du premier login : consommées par le serveur Next
 * (middleware et routes /auth), jamais par le navigateur. Elles passent le
 * proxy avec le jeton API comme tout le reste — pas de @PublicRoute.
 */
@Controller('auth-settings')
export class AuthSettingsController {
  constructor(private readonly auth: AuthSettingsService) {}

  @Get('bootstrap')
  bootstrapView(): Promise<AuthBootstrapView> {
    return this.auth.bootstrapView();
  }

  @Post('bootstrap')
  bootstrap(@Body() body: BootstrapBody): Promise<AuthBootstrapView> {
    const username = body.username?.trim() || 'admin';
    const password = body.password ?? '';
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(msg('platform.passwordTooShort', { min: MIN_PASSWORD_LENGTH }));
    }
    return this.auth.bootstrap(username, password);
  }

  @Post('verify')
  async verify(@Body() body: BootstrapBody): Promise<{ ok: boolean }> {
    return { ok: await this.auth.verify(body.username ?? '', body.password ?? '') };
  }
}
