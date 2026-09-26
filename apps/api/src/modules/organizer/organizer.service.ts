import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  AI_PORT,
  AiPort,
  EVENTS,
  N8N_API_PORT,
  N8nApiPort,
  N8nWorkflow,
  msg,
  writeInLanguage,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';

import { EventBusService } from '../../infra/events/event-bus.service';
import { InstancesService } from '../instances/instances.service';
import { WorkflowSyncService } from '../workflows/workflow-sync.service';
import { WorkflowLockService } from '../../infra/workflow-lock/workflow-lock.service';

export interface OrganizePlanItem {
  workflowId: string;
  currentName: string;
  newName: string;
  tags: string[];
  folder: string;
  reason: string;
}

const DEFAULT_CONVENTION =
  '[domain] - [action] (e.g. "CRM - Sync Airtable contacts", "Billing - Unpaid invoice reminder"). ' +
  'Short tags in kebab-case. folder = domain.';

@Injectable()
export class OrganizerService {
  private readonly logger = new Logger(OrganizerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly instances: InstancesService,
    private readonly sync: WorkflowSyncService,
    @Inject(AI_PORT) private readonly ai: AiPort,
    @Inject(N8N_API_PORT) private readonly n8n: N8nApiPort,
    private readonly settings: PlatformSettingsService,
    private readonly locks: WorkflowLockService,
  ) {}

  /** Propose un plan de rangement pour tous les workflows d'une instance. */
  async plan(instanceId: string, convention?: string): Promise<OrganizePlanItem[]> {
    if (!(await this.ai.isConfigured())) {
      throw new BadRequestException(msg('analysis.organizerAiRequired'));
    }
    const workflows = await this.prisma.workflow.findMany({
      where: { instanceId, ...(await this.settings.workflowFilter()) },
    });
    if (workflows.length === 0) return [];

    const summary = workflows.map((w) => {
      const raw = w.raw as unknown as N8nWorkflow;
      return {
        workflowId: w.id,
        name: w.name,
        tags: w.tags,
        active: w.active,
        nodeTypes: [...new Set(raw.nodes.map((n) => n.type.split('.').pop()))].slice(0, 12),
      };
    });

    const items = await this.ai.generateJson<OrganizePlanItem[]>({
      system:
        'You organise a catalog of n8n workflows. Naming convention: ' +
        `${convention ?? DEFAULT_CONVENTION}\n` +
        'For each workflow, propose a better name (keep it if already good), tags, a folder. ' +
        'Keep an "[ARCHIVED]" prefix and an environment suffix (" - DEV", " - PROD"…) exactly as they are. ' +
        `${writeInLanguage()}\n` +
        'Answer in JSON: [{"workflowId": "...", "currentName": "...", "newName": "...", ' +
        '"tags": ["..."], "folder": "...", "reason": "..."}]',
      prompt: JSON.stringify(summary),
      maxTokens: 8192,
    });
    return items;
  }

  /** Applique un plan : rename + tags (folder posé en tag `folder:<name>`). */
  async apply(items: OrganizePlanItem[]): Promise<{ applied: number }> {
    // Tout le plan d'abord : un refus au milieu laisserait la moitié du parc renommée.
    await this.locks.assertWritable(items.map((item) => item.workflowId));
    let applied = 0;
    for (const item of items) {
      const workflow = await this.prisma.workflow.findUnique({ where: { id: item.workflowId } });
      if (!workflow) continue;
      const config = await this.instances.getConfig(workflow.instanceId);
      const raw = workflow.raw as unknown as N8nWorkflow;

      // Rename via PUT
      if (item.newName && item.newName !== workflow.name) {
        await this.n8n.updateWorkflow(config, workflow.externalId, { ...raw, name: item.newName });
      }

      // Tags : création si absents puis affectation
      const wantedTags = [
        ...new Set([...(item.tags ?? []), ...(item.folder ? [`folder:${item.folder}`] : [])]),
      ];
      if (wantedTags.length > 0) {
        try {
          const existing = await this.n8n.listTags(config);
          const tagIds: string[] = [];
          for (const name of wantedTags) {
            const found = existing.find((t) => t.name === name);
            tagIds.push(found ? found.id : (await this.n8n.createTag(config, name)).id);
          }
          await this.n8n.setWorkflowTags(config, workflow.externalId, tagIds);
        } catch (error) {
          this.logger.warn(`Tags failed for "${workflow.name}": ${(error as Error).message}`);
        }
      }

      // Resync immédiat du snapshot local — name/tags/raw depuis n8n (émet workflow.synced)
      const fresh = await this.n8n.getWorkflow(config, workflow.externalId);
      await this.sync.upsertWorkflow(workflow.instanceId, fresh);
      applied += 1;
    }
    this.eventBus.emit(EVENTS.organizerApplied, { applied });
    return { applied };
  }
}
