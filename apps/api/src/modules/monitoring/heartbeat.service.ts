import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EVENTS, MONITOR_PORT, MonitorPort, msg } from '@nwm/core';
import { Monitor } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EventBusService } from '../../infra/events/event-bus.service';

/** Réception des heartbeats envoyés par les workflows (nœud HTTP Request). */
@Injectable()
export class HeartbeatService {
  private readonly logger = new Logger(HeartbeatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    @Inject(MONITOR_PORT) private readonly monitorPort: MonitorPort,
  ) {}

  async beat(token: string, status: 'up' | 'down' = 'up', message?: string): Promise<Monitor> {
    const monitor = await this.prisma.monitor.findUnique({ where: { token } });
    if (!monitor || !monitor.enabled || monitor.kind !== 'heartbeat') {
      throw new NotFoundException(msg('ops.heartbeatNotFound'));
    }
    const updated = await this.prisma.monitor.update({
      where: { id: monitor.id },
      data: { lastStatus: status, lastCheckAt: new Date() },
    });
    if (monitor.kumaPushUrl) {
      try {
        await this.monitorPort.push(monitor.kumaPushUrl, status, message);
      } catch (error) {
        this.logger.warn(`Kuma push failed for ${monitor.name}: ${(error as Error).message}`);
      }
    }
    this.eventBus.emit(EVENTS.monitorBeat, { monitorId: monitor.id, status });
    return updated;
  }

  /** Snippet du nœud HTTP Request à coller dans le workflow. */
  buildSnippet(monitor: Monitor, apiBaseUrl: string): object {
    return {
      name: `Heartbeat ${monitor.name}`,
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      parameters: {
        method: 'POST',
        url: `${apiBaseUrl}/monitoring/beat/${monitor.token}`,
        options: { timeout: 5000 },
      },
      position: [0, 0],
    };
  }
}
