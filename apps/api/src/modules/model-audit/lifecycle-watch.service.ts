import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EVENTS, ModelLifecycleChangedEvent, msg } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EventBusService } from '../../infra/events/event-bus.service';
import { ModuleRegistryService } from '../../infra/modules-registry/module-registry.service';
import { MODEL_AUDIT_MANIFEST } from './manifest';
import { ModelAuditService } from './model-audit.service';
import { ModelAuditSettingsService } from './model-audit-settings.service';

/** Les statuts qui méritent qu'on réveille quelqu'un. */
const ALERTING = new Set(['deprecated', 'retired']);

export interface LifecycleCheckResult {
  announced: number;
  armed: boolean;
}

/**
 * Le chien de garde du cycle de vie : un modèle du parc vient de passer
 * déprécié ou retiré.
 *
 * Une alerte par TRANSITION DE MODÈLE, jamais par workflow — quarante nœuds
 * touchés feraient quarante fois la même nouvelle. L'état vit dans
 * `ModelLifecycleAlert`, dérivé et reconstructible, comme `PerfDriftAlert`.
 *
 * Et le premier passage n'annonce RIEN : sans cet amorçage, la mise en service
 * du module annoncerait comme une nouvelle tout ce qui est déprécié depuis deux
 * ans.
 */
@Injectable()
export class LifecycleWatchService {
  private readonly logger = new Logger(LifecycleWatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly registry: ModuleRegistryService,
    private readonly audit: ModelAuditService,
    private readonly settings: ModelAuditSettingsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async tick(): Promise<void> {
    if (!(await this.registry.isEnabled(MODEL_AUDIT_MANIFEST.id))) return;
    try {
      await this.audit.auditAll();
      await this.check();
    } catch (error) {
      this.logger.warn(`Model audit failed: ${(error as Error).message}`);
    }
  }

  async check(): Promise<LifecycleCheckResult> {
    const summary = await this.audit.summary();
    const known = await this.prisma.modelLifecycleAlert.findMany();
    const announced = new Map(known.map((row) => [row.pattern, row.status]));
    const armed = await this.settings.armLifecycle();

    let count = 0;
    for (const model of summary.models) {
      const status = model.status ?? 'active';
      const key = model.model.toLowerCase();
      if (!ALERTING.has(status)) {
        // Le modèle est redevenu ordinaire (ou n'a jamais alerté) : on réarme.
        if (announced.has(key)) await this.prisma.modelLifecycleAlert.delete({ where: { pattern: key } });
        continue;
      }
      if (announced.get(key) === status) continue;
      await this.prisma.modelLifecycleAlert.upsert({
        where: { pattern: key },
        create: { pattern: key, status },
        update: { status, alertedAt: new Date() },
      });
      if (!armed) continue; // Amorçage : on retient l'état sans réveiller personne.
      const payload: ModelLifecycleChangedEvent = {
        pattern: model.model,
        provider: model.provider ?? msg('analysis.unknownProvider'),
        from: announced.get(key) ?? 'active',
        to: status,
        retiresAt: model.retiresAt,
        replacedByPattern: model.replacedByPattern,
        workflows: await this.audit.workflowsUsing(model.model),
        occurredAt: new Date().toISOString(),
      };
      this.eventBus.emit(EVENTS.modelLifecycleChanged, payload);
      count++;
    }
    return { announced: count, armed };
  }
}
