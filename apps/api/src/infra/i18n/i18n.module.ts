import { Global, MiddlewareConsumer, Module, NestModule, OnModuleInit } from '@nestjs/common';
import { setLocaleResolver } from '@nwm/core';
import { PlatformSettingsService } from '../settings/platform-settings.service';
import { requestLocale } from './locale-context';
import { LocaleContextMiddleware } from './locale-context.middleware';
import { PlatformLocale } from './platform-locale';

/** Global : la langue de chaque texte produit, celle de la requête sinon celle de la plateforme. */
@Global()
@Module({
  providers: [PlatformLocale],
  exports: [PlatformLocale],
})
export class I18nModule implements NestModule, OnModuleInit {
  constructor(private readonly settings: PlatformSettingsService) {}

  async onModuleInit(): Promise<void> {
    setLocaleResolver(() => requestLocale() ?? this.settings.defaultLocale());
    // Amorce le cache : un cron qui tourne avant toute lecture des réglages écrirait sinon en `fr`.
    await this.settings.get().catch(() => undefined);
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(LocaleContextMiddleware).forRoutes('*');
  }
}
