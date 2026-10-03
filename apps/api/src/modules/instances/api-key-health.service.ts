import { Injectable, Logger } from '@nestjs/common';
import {
  EVENTS,
  InstanceApiKeyExpiryEvent,
  InstanceApiKeyRejectedEvent,
  apiKeyTier,
  apiKeyTierToAlert,
  isApiKeyRefusal,
  isApiKeyTier,
  jwtExpiresAt,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EventBusService } from '../../infra/events/event-bus.service';

/**
 * Santé de la clé API de chaque instance : son échéance, et le refus de la plateforme.
 * Une alerte par TRANSITION (palier franchi, refus apparu), jamais une par passe —
 * c'est la base qui s'en souvient, pas un compteur en mémoire.
 */
@Injectable()
export class ApiKeyHealthService {
  private readonly logger = new Logger(ApiKeyHealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
  ) {}

  async checkExpiries(now = new Date()): Promise<void> {
    const instances = await this.prisma.instance.findMany({
      select: { id: true, name: true, apiKey: true, apiKeyExpiresAt: true, apiKeyAlertedTier: true },
    });
    for (const instance of instances) {
      // Relue dans la clé à chaque passe : rattrape les instances enregistrées avant la colonne.
      const expiresAt = jwtExpiresAt(instance.apiKey);
      if (expiresAt?.getTime() !== instance.apiKeyExpiresAt?.getTime()) {
        await this.prisma.instance.update({
          where: { id: instance.id },
          data: { apiKeyExpiresAt: expiresAt },
        });
      }
      const lastAlerted = isApiKeyTier(instance.apiKeyAlertedTier) ? instance.apiKeyAlertedTier : null;
      const tier = apiKeyTierToAlert(apiKeyTier(expiresAt, now), lastAlerted);
      if (!tier || !expiresAt) continue;

      // Conditionnel sur le palier lu : deux passes concurrentes n'émettent qu'une fois.
      const { count } = await this.prisma.instance.updateMany({
        where: { id: instance.id, apiKeyAlertedTier: instance.apiKeyAlertedTier },
        data: { apiKeyAlertedTier: tier },
      });
      if (count === 0) continue;
      this.eventBus.emit(tier === 'expired' ? EVENTS.instanceApiKeyExpired : EVENTS.instanceApiKeyExpiring, {
        instanceId: instance.id,
        instanceName: instance.name,
        tier,
        expiresAt: expiresAt.toISOString(),
        occurredAt: now.toISOString(),
      } satisfies InstanceApiKeyExpiryEvent);
    }
  }

  /**
   * Joue un appel qui s'authentifie avec la clé de l'instance. Accepté : le refus en
   * cours est levé. Refusé (401/403) : il est posé et annoncé, une fois. L'erreur
   * repart telle quelle — ce service observe, il ne décide pas de la réponse.
   */
  async watch<T>(instanceId: string, call: () => Promise<T>): Promise<T> {
    let result: T;
    try {
      result = await call();
    } catch (error) {
      if (isApiKeyRefusal(error)) await this.recordRejected(instanceId, error);
      throw error;
    }
    await this.prisma.instance.updateMany({
      where: { id: instanceId, apiKeyRejectedAt: { not: null } },
      data: { apiKeyRejectedAt: null },
    });
    return result;
  }

  private async recordRejected(instanceId: string, error: unknown): Promise<void> {
    try {
      const now = new Date();
      const { count } = await this.prisma.instance.updateMany({
        where: { id: instanceId, apiKeyRejectedAt: null },
        data: { apiKeyRejectedAt: now },
      });
      if (count === 0) return;
      const instance = await this.prisma.instance.findUnique({
        where: { id: instanceId },
        select: { name: true },
      });
      this.eventBus.emit(EVENTS.instanceApiKeyRejected, {
        instanceId,
        instanceName: instance?.name ?? instanceId,
        status: (error as { status: number }).status,
        reason: ((error as Error).message ?? '').slice(0, 300),
        occurredAt: now.toISOString(),
      } satisfies InstanceApiKeyRejectedEvent);
    } catch (failure) {
      // Ne jamais masquer le refus d'origine par une erreur de journalisation.
      this.logger.warn(`Could not record API key refusal: ${(failure as Error).message}`);
    }
  }
}
