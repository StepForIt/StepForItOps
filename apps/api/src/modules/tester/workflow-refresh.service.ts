import { Injectable, Logger } from '@nestjs/common';
import { WorkflowSyncService } from '../workflows/workflow-sync.service';

/**
 * Repull du workflow juste avant un test : le miroir local ne bouge qu'au cron
 * horaire ou sur une synchro d'instance, et tester la version d'il y a une heure
 * revient à valider un workflow que personne n'exécute plus.
 *
 * Au pire échec (n8n injoignable, workflow supprimé), on n'annule PAS le test :
 * l'appel qui suit portera lui-même l'erreur, avec son vrai message.
 */
@Injectable()
export class WorkflowRefreshService {
  private readonly logger = new Logger(WorkflowRefreshService.name);

  constructor(private readonly sync: WorkflowSyncService) {}

  async refresh(workflowId: string): Promise<void> {
    try {
      await this.sync.syncWorkflow(workflowId);
    } catch (error) {
      this.logger.warn(`Resynchro avant test impossible (${workflowId}) : ${(error as Error).message}`);
    }
  }
}
