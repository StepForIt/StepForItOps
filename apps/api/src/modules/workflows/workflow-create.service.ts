import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { N8N_API_PORT, N8nApiPort, buildBlankWorkflow } from '@nwm/core';
import { InstancesService } from '../instances/instances.service';
import { WorkflowSyncService } from './workflow-sync.service';
import { WorkflowWithEnv, WorkflowsService } from './workflows.service';

/**
 * Création d'un workflow neuf dans n8n, puis dans le miroir local.
 *
 * Le workflow part vide et inactif : la plateforme ne sait pas encore ce qu'il
 * doit faire, c'est l'assistant qui le construit ensuite, opération par
 * opération, chacune revue en diff comme n'importe quelle autre modification.
 */
@Injectable()
export class WorkflowCreateService {
  private readonly logger = new Logger(WorkflowCreateService.name);

  constructor(
    private readonly workflows: WorkflowsService,
    private readonly sync: WorkflowSyncService,
    private readonly instances: InstancesService,
    @Inject(N8N_API_PORT) private readonly n8n: N8nApiPort,
  ) {}

  async create(instanceId: string, name: string): Promise<WorkflowWithEnv> {
    const trimmed = name?.trim();
    if (!trimmed) throw new BadRequestException('Nom du workflow attendu');
    const config = await this.instances.getConfig(instanceId);

    const created = await this.n8n.createWorkflow(config, buildBlankWorkflow(trimmed));
    // Le miroir local est alimenté par la réponse de n8n, jamais par ce qu'on a
    // envoyé : c'est elle qui porte l'id, et elle seule dit ce que n8n a retenu.
    const synced = await this.sync.upsertWorkflow(instanceId, created);
    this.logger.log(`Workflow « ${trimmed} » créé sur l'instance ${instanceId} (n8n ${synced.externalId})`);
    return this.workflows.get(synced.workflowId);
  }
}
