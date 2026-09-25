import { Module } from '@nestjs/common';
import { AppLogsController } from './app-logs.controller';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';
import { APP_LOGS_MANIFEST } from './manifest';

/**
 * L'écran seulement : la capture des lignes vit dans `infra/logging`, toujours
 * active. Un module désactivé ferme la porte, il n'éteint pas l'enregistreur.
 */
@Module({
  controllers: [AppLogsController],
  providers: [manifestProvider(APP_LOGS_MANIFEST)],
})
export class AppLogsModule {}
