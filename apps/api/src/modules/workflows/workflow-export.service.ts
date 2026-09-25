import { Injectable, Logger } from '@nestjs/common';
import {
  N8nWorkflow,
  PlatformId,
  blueprintExportText,
  blueprintModuleCount,
  workflowExportFileName,
  workflowExportText,
} from '@nwm/core';
import { WorkflowsService } from './workflows.service';

export interface WorkflowJsonExport {
  platform: PlatformId;
  fileName: string;
  /** Le JSON indenté, tel qu'il sera copié ou téléchargé — l'API ne le re-sérialise pas. */
  json: string;
  workflowName: string;
  /** Nœuds n8n ou modules Make. */
  nodeCount: number;
  /** Le workflow porte des données épinglées (dites ou non dans `json`, cf. `pinDataIncluded`). Jamais chez Make. */
  hasPinData: boolean;
  pinDataIncluded: boolean;
  /** L'export vient du miroir local : la plateforme n'a pas répondu, ou ne connaît plus ce workflow. */
  stale: boolean;
  /** Date de la copie locale (dernière écriture de la synchro), affichée quand `stale`. */
  syncedAt: Date;
}

/**
 * Sort le contenu d'un workflow de la plateforme, pour le coller à une IA, le
 * garder de côté, ou le réimporter à la main — JSON n8n nettoyé de son identité
 * (`workflow-export-json.ts`), ou blueprint Make tel quel (`blueprint-export.ts`).
 * Ce service ne décide que d'une chose : d'OÙ vient le contenu.
 *
 * Il repart de la plateforme, parce qu'un export est fait pour être relu ailleurs
 * et que le miroir local date au mieux du dernier cron horaire — un JSON envoyé à
 * une IA ou réimporté ailleurs vaut l'état d'hier, sans que rien ne le dise. Mais
 * une plateforme injoignable ne doit pas priver d'export : on retombe alors sur
 * la copie locale en le DISANT (`stale` + `syncedAt`), plutôt que d'échouer ou de
 * livrer un état périmé en silence.
 */
@Injectable()
export class WorkflowExportService {
  private readonly logger = new Logger(WorkflowExportService.name);

  constructor(private readonly workflows: WorkflowsService) {}

  async export(
    id: string,
    options: { fresh?: boolean; includePinData?: boolean } = {},
  ): Promise<WorkflowJsonExport> {
    const { raw, workflow, stale } = await this.load(id, options.fresh !== false);
    const common = { workflowName: workflow.name, stale, syncedAt: workflow.updatedAt };

    if (workflow.platform === 'make') {
      return {
        ...common,
        platform: 'make',
        // Le suffixe de Make lui-même : le fichier se reconnaît pour ce qu'il est.
        fileName: workflowExportFileName(workflow.name).replace(/\.json$/, '.blueprint.json'),
        json: blueprintExportText(raw),
        nodeCount: blueprintModuleCount(raw),
        hasPinData: false,
        pinDataIncluded: false,
      };
    }

    const n8n = raw as N8nWorkflow;
    const includePinData = Boolean(options.includePinData);
    const hasPinData = Object.keys(n8n.pinData ?? {}).length > 0;
    return {
      ...common,
      platform: 'n8n',
      fileName: workflowExportFileName(workflow.name),
      json: workflowExportText(n8n, { includePinData }),
      nodeCount: n8n.nodes?.length ?? 0,
      hasPinData,
      pinDataIncluded: includePinData && hasPinData,
    };
  }

  private async load(id: string, fresh: boolean) {
    if (!fresh) return { ...(await this.workflows.getRawAny(id)), stale: false };
    try {
      const { raw, workflow, missing } = await this.workflows.getFreshRawAny(id);
      return { raw, workflow, stale: missing };
    } catch (error) {
      this.logger.warn(`Export ${id} : plateforme injoignable (${(error as Error).message}) — copie locale`);
      return { ...(await this.workflows.getRawAny(id)), stale: true };
    }
  }
}
