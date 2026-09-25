import { Inject, Injectable, Logger } from '@nestjs/common';
import { AI_PORT, AiPort, EVENTS, N8N_API_PORT, N8nApiPort, buildStickyZones } from '@nwm/core';
import { EventBusService } from '../../infra/events/event-bus.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { WorkflowSyncService } from '../workflows/workflow-sync.service';
import { InstancesService } from '../instances/instances.service';
import { findStickyIssues } from './sticky-rules';
import { StickyApplySpec, applyStickySpecs } from './apply-stickies';
import { WorkflowLockService } from '../../infra/workflow-lock/workflow-lock.service';

export interface StickySuggestion extends StickyApplySpec {
  reason: string;
}

/** Suggestions IA de documentation des zones (sticky notes) + application via l'API n8n. */
@Injectable()
export class StickySuggestionsService {
  private readonly logger = new Logger(StickySuggestionsService.name);

  constructor(
    private readonly eventBus: EventBusService,
    private readonly workflows: WorkflowsService,
    private readonly sync: WorkflowSyncService,
    private readonly instances: InstancesService,
    @Inject(AI_PORT) private readonly ai: AiPort,
    @Inject(N8N_API_PORT) private readonly n8n: N8nApiPort,
    private readonly locks: WorkflowLockService,
  ) {}

  /** Propose de compléter les stickies vides et de couvrir les nœuds hors zone. */
  async suggestStickies(workflowId: string): Promise<StickySuggestion[]> {
    if (!(await this.ai.isConfigured())) return [];
    const { raw } = await this.workflows.getRaw(workflowId);
    const zones = buildStickyZones(raw);
    const issues = findStickyIssues(raw);

    const toFill = issues.filter((f) => f.code === 'sticky-missing-content').map((f) => f.nodeName as string);
    const uncovered = issues
      .filter((f) => f.code === 'sticky-uncovered-nodes')
      .flatMap((f) => (f.data?.names as string[]) ?? []);
    if (toFill.length === 0 && uncovered.length === 0) return [];

    const nodeByName = new Map(raw.nodes.map((n) => [n.name, n]));
    const payload = {
      workflowName: raw.name,
      existingZones: zones.stickies.map((s) => ({
        name: s.name,
        content: s.content,
        color: s.color ?? 1,
        parent: zones.parentOf.get(s.name),
        nodes: (zones.nodesByZone.get(s.name) ?? []).map((name) => ({
          name,
          type: nodeByName.get(name)?.type,
        })),
      })),
      stickiesToFill: toFill,
      uncoveredNodes: uncovered.map((name) => ({
        name,
        type: nodeByName.get(name)?.type,
        position: nodeByName.get(name)?.position,
      })),
    };

    try {
      const suggestions = await this.ai.generateJson<StickySuggestion[]>({
        system:
          'Tu documentes un workflow n8n avec des sticky notes (zones visuelles). ' +
          'Pour chaque sticky listée dans "stickiesToFill", propose un contenu ({"action":"update","stickyName":"..."}). ' +
          'Regroupe les nœuds de "uncoveredNodes" en zones cohérentes par rôle et par proximité (position), ' +
          'et propose une création par zone ({"action":"create","nodeNames":["..."]}). ' +
          'Contenu : markdown court EN FRANÇAIS commençant par un titre "## ", 1-3 phrases décrivant le rôle de la zone. ' +
          'Couleur : optionnelle, entier 1-7, différente de la zone parente le cas échéant. ' +
          'Ne propose JAMAIS de position ni de taille (calculées côté serveur). ' +
          'Réponds en JSON: [{"action":"create"|"update","stickyName":"...","content":"...","color":1,"nodeNames":["..."],"reason":"..."}]',
        prompt: JSON.stringify(payload),
        maxTokens: 4096,
      });
      const stickyNames = new Set(zones.stickies.map((s) => s.name));
      const nodeNames = new Set(raw.nodes.map((n) => n.name));
      return suggestions.filter((s) => {
        if (!s.content?.trim()) return false;
        if (s.action === 'update') return !!s.stickyName && stickyNames.has(s.stickyName);
        if (s.action === 'create') return (s.nodeNames ?? []).some((name) => nodeNames.has(name));
        return false;
      });
    } catch (error) {
      this.logger.warn(`Suggestions sticky IA KO : ${(error as Error).message}`);
      return [];
    }
  }

  /** Applique les specs (créations/complétions) puis PUT vers n8n. */
  async applyStickies(workflowId: string, specs: StickyApplySpec[]): Promise<{ applied: number }> {
    if (specs.length === 0) return { applied: 0 };
    await this.locks.assertWritable(workflowId);
    const { workflow, raw } = await this.workflows.getRaw(workflowId);
    const { workflow: updated, applied } = applyStickySpecs(raw, specs);
    if (applied === 0) return { applied: 0 };

    const config = await this.instances.getConfig(workflow.instanceId);
    await this.n8n.updateWorkflow(config, workflow.externalId, updated);

    // Resynchronise le snapshot local : sans ça, les analyses relisent l'ancien raw en DB.
    const fresh = await this.n8n.getWorkflow(config, workflow.externalId);
    await this.sync.upsertWorkflow(workflow.instanceId, fresh);

    this.eventBus.emit(EVENTS.optimizerApplied, { workflowId, stickiesApplied: applied });
    return { applied };
  }
}
