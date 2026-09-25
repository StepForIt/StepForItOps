import { Module } from '@nestjs/common';
import { NotificationChannelsController } from './notification-channels.controller';
import { NotifierService } from './notifier.service';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';
import { NOTIFIER_MANIFEST } from './manifest';

@Module({
  controllers: [NotificationChannelsController],
  providers: [NotifierService, manifestProvider(NOTIFIER_MANIFEST)],
})
export class NotifierModule {}
