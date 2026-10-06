import { Global, Module } from '@nestjs/common';
import { EventBusService } from './event-bus.service';
import { EventLogPurgeService } from './event-log-purge.service';

@Global()
@Module({
  providers: [EventBusService, EventLogPurgeService],
  exports: [EventBusService],
})
export class EventBusModule {}
