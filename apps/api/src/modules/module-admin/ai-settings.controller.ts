import { BadRequestException, Body, Controller, Delete, Get, Post, Put, Query } from '@nestjs/common';
import { isAiProvider, msg } from '@nwm/core';
import { AiSettingsInput, AiSettingsService, AiSettingsView } from './ai-settings.service';

/**
 * Réglages IA : clé et modèle par fournisseur (stockés en DB, prioritaires sur
 * les variables d'env ANTHROPIC_* / MISTRAL_*), et lequel sert les appels.
 */
@Controller('settings/ai')
export class AiSettingsController {
  constructor(private readonly settings: AiSettingsService) {}

  @Get()
  get(): Promise<AiSettingsView> {
    return this.settings.get();
  }

  @Put()
  save(@Body() body: AiSettingsInput): Promise<AiSettingsView> {
    return this.settings.save(body);
  }

  /** Bascule le fournisseur servant les appels, sans toucher aux clés. */
  @Post('activate')
  activate(@Body() body: { provider?: string }): Promise<AiSettingsView> {
    if (!isAiProvider(body?.provider)) {
      throw new BadRequestException(
        msg('platform.aiProviderUnknown', { provider: body?.provider ?? msg('platform.aiProviderAbsent') }),
      );
    }
    return this.settings.activate(body.provider);
  }

  @Delete()
  clear(@Query('provider') provider?: string): Promise<AiSettingsView> {
    return this.settings.clear(provider);
  }

  @Post('test')
  test(@Body() body?: AiSettingsInput): Promise<{ ok: true }> {
    return this.settings.test(body);
  }
}
