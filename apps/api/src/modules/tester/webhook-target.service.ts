import { Inject, Injectable, Logger } from '@nestjs/common';
import { N8N_API_PORT, N8nApiPort, N8nInstanceConfig, N8nWorkflow, msg } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { findWebhookOwners } from './webhook-finder';

export type WebhookTargetVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Décide si appeler `/webhook/<path>` déclenchera BIEN le workflow visé.
 *
 * n8n enregistre les webhooks de production par path, à l'échelle de l'instance,
 * et seul un workflow actif en tient un. Une copie d'environnement garde le path
 * de son original : appeler ce path depuis la copie inactive exécute l'autre — la
 * prod, en général. Un test qui déclenche la production n'est pas un test, donc on
 * refuse plutôt que d'envoyer et de comparer des résultats qui ne viennent pas du
 * workflow demandé.
 */
@Injectable()
export class WebhookTargetService {
  private readonly logger = new Logger(WebhookTargetService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(N8N_API_PORT) private readonly n8n: N8nApiPort,
  ) {}

  async check(
    config: N8nInstanceConfig,
    workflow: { id: string; externalId: string; instanceId: string; name: string },
    webhook: { path: string; method: string },
  ): Promise<WebhookTargetVerdict> {
    // L'état d'activation vient de n8n, pas du miroir local : celui-ci ne se
    // resynchronise qu'à l'heure, et refuser un workflow activé il y a deux minutes
    // serait un faux blocage.
    let active: boolean;
    try {
      const live = await this.n8n.getWorkflow(config, workflow.externalId);
      active = live.active === true;
    } catch (error) {
      this.logger.warn(`Unreadable n8n state for ${workflow.name}: ${(error as Error).message}`);
      return { ok: true }; // n8n muet : on ne bloque pas sur une incertitude technique.
    }
    if (active) return { ok: true };

    const holder = await this.activeHolder(workflow, webhook);
    if (holder) {
      return {
        ok: false,
        reason: msg('platform.webhookHeldByOther', {
          name: workflow.name,
          method: webhook.method,
          path: webhook.path,
          holder: holder.name,
        }),
      };
    }
    return {
      ok: false,
      reason: msg('platform.webhookInactive', { name: workflow.name, path: webhook.path }),
    };
  }

  /** L'autre workflow de l'instance qui tient ce path, s'il y en a un d'actif. */
  private async activeHolder(
    workflow: { id: string; instanceId: string },
    webhook: { path: string; method: string },
  ): Promise<{ id: string; name: string } | null> {
    const siblings = await this.prisma.workflow.findMany({
      where: { instanceId: workflow.instanceId, active: true, id: { not: workflow.id } },
      select: { id: true, name: true, active: true, raw: true },
    });
    const owners = findWebhookOwners(
      siblings.map((s) => ({ ...s, raw: s.raw as unknown as N8nWorkflow })),
      webhook.path,
      webhook.method,
    );
    return owners[0] ?? null;
  }
}
