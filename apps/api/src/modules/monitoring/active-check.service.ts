import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MONITOR_PORT, MonitorPort, isCheckDue } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ModuleRegistryService } from '../../infra/modules-registry/module-registry.service';
import { MONITORING_MANIFEST } from './manifest';
import { DEFAULT_ACTIVE_INTERVAL_SECONDS } from './probe-interval';

interface ActiveConfig {
  url?: string;
  method?: string;
  intervalSeconds?: number;
  expectedStatus?: number;
}

/** Checks actifs : appelle l'URL configurée (ex: webhook du workflow) à intervalle régulier. */
@Injectable()
export class ActiveCheckService {
  private readonly logger = new Logger(ActiveCheckService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ModuleRegistryService,
    @Inject(MONITOR_PORT) private readonly monitorPort: MonitorPort,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (!(await this.registry.isEnabled(MONITORING_MANIFEST.id))) return;
    const monitors = await this.prisma.monitor.findMany({ where: { kind: 'active', enabled: true } });
    const now = Date.now();

    for (const monitor of monitors) {
      const config = (monitor.config ?? {}) as ActiveConfig;
      const interval = config.intervalSeconds ?? DEFAULT_ACTIVE_INTERVAL_SECONDS;
      if (!isCheckDue(monitor.lastCheckAt, interval, now)) continue;
      await this.check(monitor.id, config, monitor.kumaPushUrl);
    }
  }

  async check(monitorId: string, config: ActiveConfig, kumaPushUrl: string | null): Promise<'up' | 'down'> {
    let status: 'up' | 'down' = 'down';
    let message = '';
    const started = Date.now();
    try {
      if (!config.url) throw new Error('config.url missing');
      const response = await fetch(config.url, { method: config.method ?? 'GET' });
      const expected = config.expectedStatus ?? 200;
      status = response.status === expected || (expected === 200 && response.ok) ? 'up' : 'down';
      message = `HTTP ${response.status}`;
    } catch (error) {
      message = (error as Error).message;
    }
    const pingMs = Date.now() - started;

    await this.prisma.monitor.update({
      where: { id: monitorId },
      data: { lastStatus: status, lastCheckAt: new Date() },
    });
    if (kumaPushUrl) {
      try {
        await this.monitorPort.push(kumaPushUrl, status, message, pingMs);
      } catch (error) {
        this.logger.warn(`Kuma push failed: ${(error as Error).message}`);
      }
    }
    return status;
  }
}
