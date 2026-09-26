import { Injectable, NotFoundException } from '@nestjs/common';
import { msg } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';

export interface ChecklistStep {
  key: string;
  label: string;
  /** true = fait, false = à faire, null = étape manuelle non vérifiable automatiquement. */
  done: boolean | null;
  detail?: string;
  /** Explication « à quoi ça sert » affichée en tooltip derrière le (i). */
  help?: string;
  /** Action automatisable côté UI (le monitorId cible est fourni quand il existe). */
  action?: 'create-monitor' | 'enable-monitor' | 'provision-kuma' | 'run-check';
}

export interface InstanceChecklist {
  instanceId: string;
  instanceName: string;
  monitorId?: string;
  steps: ChecklistStep[];
}

/** Marqueur des anciens workflows n8n de monitoring d'erreurs (poll de l'API depuis n8n). */
const LEGACY_ERROR_CHECK_MARKER = 'executions?status=error';

/**
 * État de la migration monitoring d'une instance : checklist affichée sur la page
 * Instances (ce qui est fait / ce qu'il reste à faire), avec actions automatisables.
 */
@Injectable()
export class MonitoringChecklistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
  ) {}

  async forInstance(instanceId: string): Promise<InstanceChecklist> {
    const instance = await this.prisma.instance.findUnique({ where: { id: instanceId } });
    if (!instance) throw new NotFoundException(msg('ops.instanceNotFound', { id: instanceId }));

    const monitor = await this.prisma.monitor.findFirst({
      where: { kind: 'error-watch', config: { path: ['instanceId'], equals: instanceId } },
    });
    const state = (monitor?.state ?? {}) as { lastSeenExecutionId?: string };
    const workflows = await this.prisma.workflow.findMany({
      where: { instanceId, ...(await this.settings.workflowFilter()) },
      select: { name: true, raw: true },
    });
    const legacyWorkflows = workflows
      .filter((w) => JSON.stringify(w.raw).includes(LEGACY_ERROR_CHECK_MARKER))
      .map((w) => w.name);

    const steps: ChecklistStep[] = [
      {
        key: 'monitor-exists',
        label: msg('ops.checklistMonitorExistsLabel'),
        done: monitor !== null,
        detail: monitor ? monitor.name : msg('ops.checklistMonitorExistsDetail'),
        help: msg('ops.checklistMonitorExistsHelp'),
        action: monitor ? undefined : 'create-monitor',
      },
      {
        key: 'monitor-enabled',
        label: msg('ops.checklistMonitorEnabledLabel'),
        done: monitor?.enabled ?? false,
        detail: monitor ? undefined : msg('ops.checklistMonitorEnabledDetail'),
        help: msg('ops.checklistMonitorEnabledHelp'),
        action: monitor && !monitor.enabled ? 'enable-monitor' : undefined,
      },
      {
        key: 'kuma-linked',
        label: msg('ops.checklistKumaLinkedLabel'),
        done: Boolean(monitor?.kumaPushUrl),
        detail: monitor?.kumaPushUrl ? monitor.kumaPushUrl : msg('ops.checklistKumaLinkedDetail'),
        help: msg('ops.checklistKumaLinkedHelp'),
        action: monitor && !monitor.kumaPushUrl ? 'provision-kuma' : undefined,
      },
      {
        key: 'baseline',
        label: msg('ops.checklistBaselineLabel'),
        done: Boolean(state.lastSeenExecutionId),
        detail: monitor?.lastCheckAt
          ? msg('ops.checklistBaselineDetail', {
              at: monitor.lastCheckAt.toISOString(),
              status: monitor.lastStatus ?? '?',
            })
          : undefined,
        help: msg('ops.checklistBaselineHelp'),
        action: monitor && !state.lastSeenExecutionId ? 'run-check' : undefined,
      },
      {
        key: 'legacy-removed',
        label: msg('ops.checklistLegacyRemovedLabel'),
        done: workflows.length === 0 ? null : legacyWorkflows.length === 0,
        detail:
          workflows.length === 0
            ? msg('ops.checklistLegacySyncFirst')
            : legacyWorkflows.length > 0
              ? msg('ops.checklistLegacyToDelete', { workflows: legacyWorkflows.join(', ') })
              : msg('ops.checklistLegacyNone'),
        help: msg('ops.checklistLegacyRemovedHelp'),
      },
      {
        key: 'api-key-rotated',
        label: msg('ops.checklistApiKeyLabel'),
        done: null,
        detail: msg('ops.checklistApiKeyDetail'),
        help: msg('ops.checklistApiKeyHelp'),
      },
    ];

    return { instanceId, instanceName: instance.name, monitorId: monitor?.id, steps };
  }
}
