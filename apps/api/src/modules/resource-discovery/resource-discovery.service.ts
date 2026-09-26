import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  N8N_API_PORT,
  N8nApiPort,
  N8nInstanceConfig,
  n8nWorkflowUrl,
  parseExecutionError,
  msg,
} from '@nwm/core';
import { InstancesService } from '../instances/instances.service';
import { N8nProbeService } from '../../infra/n8n-probe/n8n-probe.service';
import {
  PROBE_WORKFLOW_PREFIX,
  buildHttpProbeWorkflow,
  httpProbePayload,
} from '../../infra/n8n-probe/probe-workflow.builder';
import { readHttpProbeResponse } from '../../infra/n8n-probe/probe-response';
import { DiscoveredItem, findDiscoveryStep, normalizeHost } from './provider-catalog';

export interface DiscoverInput {
  instanceId: string;
  provider: string;
  stepId: string;
  credentialType: string;
  credentialId: string;
  credentialName?: string;
  /** Id de l'item parent pour les étapes imbriquées (baseId pour les tables…). */
  parentId?: string;
  /** Racine de l'API, pour les providers auto-hébergés (NocoDB). */
  host?: string;
  /**
   * Laisse le workflow temporaire en place quand l'appel échoue, dans l'état
   * où il a planté : supprimé, il n'y a plus rien à ouvrir dans n8n pour
   * comprendre. À réserver aux appels déclenchés par un humain — une passe de
   * masse en sèmerait un par échec.
   */
  keepOnError?: boolean;
}

/** Dernière exécution du workflow conservé : c'est là que se lit le vrai refus du provider. */
export interface DiscoveryLeftoverExecution {
  id: string;
  status: string;
  startedAt?: string;
  failedNode?: string;
  message?: string;
  url: string;
}

/** Workflow de découverte resté sur l'instance (échec conservé, ou suppression ratée). */
export interface DiscoveryLeftover {
  externalId: string;
  name: string;
  active: boolean;
  url: string;
  /** Absente quand le workflow n'a jamais tourné : l'échec est en amont (activation, webhook). */
  lastExecution?: DiscoveryLeftoverExecution;
}

@Injectable()
export class ResourceDiscoveryService {
  private readonly logger = new Logger(ResourceDiscoveryService.name);

  constructor(
    private readonly instances: InstancesService,
    private readonly probe: N8nProbeService,
    @Inject(N8N_API_PORT) private readonly n8n: N8nApiPort,
  ) {}

  /**
   * Cycle complet par la sonde partagée (`infra/n8n-probe`) : workflow temporaire
   * authentifié par le credential, un appel, puis suppression.
   */
  async discover(input: DiscoverInput): Promise<{ items: DiscoveredItem[] }> {
    const match = findDiscoveryStep(input.provider, input.stepId);
    if (!match) {
      throw new BadRequestException(
        msg('platform.discoveryUnknownStep', { provider: input.provider, stepId: input.stepId }),
      );
    }
    const { provider, step } = match;
    if (!provider.credentialTypes.includes(input.credentialType)) {
      throw new BadRequestException(
        msg('platform.discoveryCredentialMismatch', {
          credentialType: input.credentialType,
          provider: provider.provider,
        }),
      );
    }
    if (step.parentStepId && !input.parentId) {
      throw new BadRequestException(
        msg('platform.discoveryParentRequired', { stepId: step.id, parentStepId: step.parentStepId }),
      );
    }
    if (provider.needsHost && !input.host) {
      throw new BadRequestException(msg('platform.discoveryHostRequired', { provider: provider.provider }));
    }

    const config = await this.instances.getConfig(input.instanceId);
    const webhookPath = this.probe.newWebhookPath();
    const request = step.request({
      parentId: input.parentId,
      host: input.host ? normalizeHost(input.host) : undefined,
    });
    const workflow = buildHttpProbeWorkflow({
      webhookPath,
      credentialType: input.credentialType,
      credential: { id: input.credentialId, name: input.credentialName },
      label: `${provider.provider}/${step.id}`,
    });
    const items = await this.probe.run(
      config,
      workflow,
      webhookPath,
      async (call) => step.parse(readHttpProbeResponse(await call(httpProbePayload(request)), request)),
      { keepOnError: input.keepOnError },
    );
    return { items };
  }

  /** Workflows de découverte encore présents sur l'instance, avec leur dernière exécution. */
  async leftovers(instanceId: string): Promise<DiscoveryLeftover[]> {
    const config = await this.instances.getConfig(instanceId);
    const workflows = await this.n8n.listWorkflows(config);
    const kept = workflows.filter(
      (workflow) => workflow.name?.startsWith(PROBE_WORKFLOW_PREFIX) && workflow.id,
    );
    return Promise.all(
      kept.map(async (workflow) => {
        const externalId = String(workflow.id);
        return {
          externalId,
          name: workflow.name,
          active: workflow.active === true,
          url: n8nWorkflowUrl(config.baseUrl, externalId),
          lastExecution: await this.lastExecution(config, externalId),
        };
      }),
    );
  }

  /**
   * Le message de l'API ne dit que ce qui est remonté jusqu'au webhook ; le
   * refus du provider, lui, est dans l'exécution — d'où `includeData`.
   */
  private async lastExecution(
    config: N8nInstanceConfig,
    externalId: string,
  ): Promise<DiscoveryLeftoverExecution | undefined> {
    try {
      const [execution] = await this.n8n.listExecutions(config, externalId, 1, { includeData: true });
      if (!execution) return undefined;
      const detail = parseExecutionError(execution);
      return {
        id: String(execution.id),
        status: execution.status,
        startedAt: execution.startedAt,
        failedNode: detail.failedNode,
        message: detail.message,
        url: `${n8nWorkflowUrl(config.baseUrl, externalId)}/executions/${execution.id}`,
      };
    } catch (error) {
      // Une exécution illisible ne doit pas masquer le workflow conservé.
      this.logger.warn(`Unreadable executions of ${externalId}: ${(error as Error).message}`);
      return undefined;
    }
  }

  /**
   * Supprime un workflow conservé. Le nom est revérifié sur l'instance : cette
   * route prend un id n8n arbitraire, elle ne doit pouvoir effacer que ce que
   * la plateforme a elle-même créé.
   */
  async deleteLeftover(instanceId: string, externalId: string): Promise<void> {
    const config = await this.instances.getConfig(instanceId);
    const workflow = await this.n8n.getWorkflow(config, externalId);
    if (!workflow?.name?.startsWith(PROBE_WORKFLOW_PREFIX)) {
      throw new BadRequestException(msg('platform.discoveryNotProbe', { externalId }));
    }
    await this.deactivate(config, externalId);
    await this.n8n.deleteWorkflow(config, externalId);
  }

  private async deactivate(config: N8nInstanceConfig, externalId: string): Promise<void> {
    try {
      await this.n8n.activateWorkflow(config, externalId, false);
    } catch {
      /* déjà inactif */
    }
  }
}
