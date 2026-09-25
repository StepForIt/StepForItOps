import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { N8N_API_PORT, N8nApiPort, N8nInstanceConfig, N8nWorkflow } from '@nwm/core';

export interface ProbeOptions {
  /**
   * Laisse le workflow temporaire en place quand l'appel échoue, dans l'état
   * où il a planté : supprimé, il n'y a plus rien à ouvrir dans n8n pour
   * comprendre. À réserver aux appels déclenchés par un humain — une passe de
   * masse en sèmerait un par échec.
   */
  keepOnError?: boolean;
}

/** Appelle le webhook de la sonde ; le corps est la réponse brute du Respond. */
export type ProbeCall = (payload: unknown) => Promise<unknown>;

/**
 * Cycle de vie d'un workflow temporaire qui agit AVEC une credential de
 * l'instance : créé, activé, appelé autant de fois que nécessaire, puis
 * désactivé et supprimé. La plateforme n'a jamais le secret en main — c'est
 * n8n qui authentifie l'appel.
 */
@Injectable()
export class N8nProbeService {
  private readonly logger = new Logger(N8nProbeService.name);

  constructor(@Inject(N8N_API_PORT) private readonly n8n: N8nApiPort) {}

  /** Chemin de webhook unique : deux sondes simultanées ne doivent jamais se répondre. */
  newWebhookPath(): string {
    return `nwm-discovery-${randomUUID()}`;
  }

  async run<T>(
    config: N8nInstanceConfig,
    workflow: N8nWorkflow,
    webhookPath: string,
    work: (call: ProbeCall) => Promise<T>,
    options: ProbeOptions = {},
  ): Promise<T> {
    const created = await this.n8n.createWorkflow(config, workflow);
    const externalId = String(created.id);
    let result: T;
    try {
      await this.n8n.activateWorkflow(config, externalId, true);
      result = await work((payload) => this.callWithRetry(config, webhookPath, payload));
    } catch (error) {
      // Conservé tel quel — activation comprise : c'est l'état du plantage
      // qu'on vient débugger, le remettre au propre l'effacerait.
      if (options.keepOnError)
        this.logger.warn(`Sonde en échec : workflow ${externalId} conservé pour debug`);
      else await this.cleanup(config, externalId);
      throw error;
    }
    await this.cleanup(config, externalId);
    return result;
  }

  /** Le webhook de prod peut mettre ~1 s à s'enregistrer après l'activation. */
  private async callWithRetry(config: N8nInstanceConfig, path: string, payload: unknown): Promise<unknown> {
    let lastError: Error = new Error('Webhook de la sonde injoignable');
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await sleep(700);
      try {
        return await this.n8n.callWebhook(config, path, payload);
      } catch (error) {
        lastError = error as Error;
      }
    }
    throw lastError;
  }

  /**
   * Suppression du cycle nominal : un échec ne doit pas emporter le résultat
   * déjà obtenu — le workflow resté là se rattrape par les « restes » de la découverte.
   */
  private async cleanup(config: N8nInstanceConfig, externalId: string): Promise<void> {
    try {
      await this.n8n.activateWorkflow(config, externalId, false);
    } catch {
      /* déjà inactif */
    }
    try {
      await this.n8n.deleteWorkflow(config, externalId);
    } catch (error) {
      this.logger.warn(`Workflow temporaire ${externalId} non supprimé : ${(error as Error).message}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
