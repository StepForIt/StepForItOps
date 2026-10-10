import { BadRequestException, Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { CredentialCheckSettings } from '@prisma/client';
import { CredentialCheckLevel, msg } from '@nwm/core';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';
import { CREDENTIAL_CHECK_MANIFEST } from './manifest';
import {
  CredentialCheckSettingsInput,
  CredentialCheckSettingsService,
} from './credential-check-settings.service';
import {
  CheckableCredential,
  CredentialCheckResult,
  CredentialCheckService,
} from './credential-check.service';

@ModuleId(CREDENTIAL_CHECK_MANIFEST.id)
@Controller('credential-check')
export class CredentialCheckController {
  constructor(
    private readonly checks: CredentialCheckService,
    private readonly settings: CredentialCheckSettingsService,
  ) {}

  /** Les fréquences du test automatique (Paramètres → Modules). */
  @Get('settings')
  getSettings(): Promise<CredentialCheckSettings> {
    return this.settings.get();
  }

  @Put('settings')
  updateSettings(@Body() body: CredentialCheckSettingsInput): Promise<CredentialCheckSettings> {
    return this.settings.update(body ?? {});
  }

  /** Credentials de fournisseurs IA vues dans les workflows de l'instance. Aucun appel réseau. */
  @Get('credentials')
  list(@Query('instanceId') instanceId?: string): Promise<CheckableCredential[]> {
    if (!instanceId) throw new BadRequestException(msg('platform.instanceIdRequired'));
    return this.checks.list(instanceId);
  }

  /** Teste UNE credential : le lot est piloté par l'écran, un appel par credential. */
  @Post('run')
  run(
    @Body() body: { instanceId?: string; credentialId?: string; level?: CredentialCheckLevel },
  ): Promise<CredentialCheckResult> {
    if (!body?.instanceId || !body.credentialId) {
      throw new BadRequestException(msg('platform.credentialCheckInput'));
    }
    return this.checks.check(body.instanceId, body.credentialId, body.level ?? 'auth');
  }
}
