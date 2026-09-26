import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventName } from '@nwm/core';
import { PrismaService } from '../prisma/prisma.service';

/** Façade unique d'émission d'événements + journalisation en DB. */
@Injectable()
export class EventBusService {
  private readonly logger = new Logger(EventBusService.name);

  constructor(
    private readonly emitter: EventEmitter2,
    private readonly prisma: PrismaService,
  ) {}

  emit(name: EventName, payload: unknown): void {
    this.emitter.emit(name, payload);
    // Journal best-effort (jamais bloquant)
    void this.prisma.eventLog
      .create({ data: { name, payload: payload as object } })
      .catch((error) => this.logger.warn(`EventLog failed for ${name}: ${error.message}`));
  }
}
