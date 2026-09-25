import { Injectable } from '@nestjs/common';
import { envsFromChain, normalizeEnvs } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CONFIG_BUNDLE_KIND, CONFIG_BUNDLE_VERSION, ConfigBundle } from './config-bundle.types';
import { monitorInstanceId } from './monitor-instance-ref';

/** Clés considérées comme sensibles dans les configs JSON (cibles export, monitors). */
const SECRET_KEYS = ['token', 'accessToken', 'apiKey', 'clientSecret', 'refreshToken', 'password'];

function stripSecrets(config: Record<string, unknown>): Record<string, unknown> {
  const clean = { ...config };
  for (const key of SECRET_KEYS) delete clean[key];
  return clean;
}

@Injectable()
export class ConfigExportService {
  constructor(private readonly prisma: PrismaService) {}

  async buildBundle(includeSecrets: boolean): Promise<ConfigBundle> {
    const [
      instances,
      targets,
      mappings,
      monitors,
      monitoringSettings,
      aiSettings,
      moduleStates,
      platformSettings,
      findingIgnores,
      groups,
      links,
    ] = await Promise.all([
      this.prisma.instance.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.exportTarget.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.resourceMapping.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.monitor.findMany({
        orderBy: { createdAt: 'asc' },
        include: { workflow: { include: { instance: true } } },
      }),
      this.prisma.monitoringSettings.findMany(),
      this.prisma.aiSettings.findMany(),
      this.prisma.moduleState.findMany(),
      this.prisma.platformSettings.findMany(),
      this.prisma.findingIgnore.findMany({
        orderBy: { createdAt: 'asc' },
        include: { workflow: { include: { instance: true } } },
      }),
      this.prisma.workflowGroup.findMany({
        orderBy: { createdAt: 'asc' },
        include: { instance: true, workflows: { select: { externalId: true } } },
      }),
      this.prisma.workflowLink.findMany({
        orderBy: { createdAt: 'asc' },
        include: { from: { include: { instance: true } }, to: { include: { instance: true } } },
      }),
    ]);

    const instanceBaseUrlById = new Map(instances.map((instance) => [instance.id, instance.baseUrl]));

    // Ancres de portée famille : l'uuid local ne veut rien dire sur l'autre
    // plateforme, seule la clé naturelle (instance + externalId) s'y retrouve.
    const familyAnchors = await this.prisma.workflow.findMany({
      where: {
        id: { in: findingIgnores.map((f) => f.familyWorkflowId).filter((id): id is string => Boolean(id)) },
      },
      include: { instance: { select: { baseUrl: true } } },
    });
    const familyRefById = new Map(
      familyAnchors.map((w) => [w.id, { instanceBaseUrl: w.instance.baseUrl, externalId: w.externalId }]),
    );

    return {
      kind: CONFIG_BUNDLE_KIND,
      version: CONFIG_BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      includesSecrets: includeSecrets,
      instances: instances.map((i) => ({
        name: i.name,
        baseUrl: i.baseUrl,
        apiKey: includeSecrets ? i.apiKey : null,
      })),
      exportTargets: targets.map((t) => {
        const config = (t.config ?? {}) as Record<string, unknown>;
        return {
          kind: t.kind,
          name: t.name,
          config: includeSecrets ? config : stripSecrets(config),
          enabled: t.enabled,
        };
      }),
      resourceMappings: mappings.map((m) => ({
        provider: m.provider,
        logicalName: m.logicalName,
        values: (m.values ?? {}) as Record<string, unknown>,
      })),
      monitors: monitors.map((m) => {
        const config = (m.config as Record<string, unknown> | null) ?? null;
        return {
          name: m.name,
          kind: m.kind,
          token: m.token,
          kumaPushUrl: m.kumaPushUrl,
          config,
          enabled: m.enabled,
          workflowRef: m.workflow
            ? { instanceBaseUrl: m.workflow.instance.baseUrl, externalId: m.workflow.externalId }
            : null,
          instanceRef: instanceBaseUrlById.get(monitorInstanceId(config) ?? '') ?? null,
        };
      }),
      monitoringSettings: monitoringSettings.map((s) => ({
        id: s.id,
        kumaUrl: s.kumaUrl,
        kumaUsername: s.kumaUsername,
        kumaPassword: includeSecrets ? s.kumaPassword : null,
      })),
      aiSettings: aiSettings.map((s) => ({
        id: s.id,
        model: s.model,
        apiKey: includeSecrets ? s.apiKey : null,
        active: s.active,
      })),
      moduleStates: moduleStates.map((s) => ({
        id: s.id,
        enabled: s.enabled,
        settings: (s.settings as Record<string, unknown> | null) ?? null,
      })),
      platformSettings: platformSettings.map((s) => ({
        id: s.id,
        includeArchived: s.includeArchived,
        envs: normalizeEnvs(s.envs ?? envsFromChain(s.envChain)),
        envChainMode: s.envChainMode,
      })),
      findingIgnores: findingIgnores.map((f) => ({
        module: f.module,
        code: f.code,
        nodeName: f.nodeName,
        nodeId: f.nodeId,
        message: f.message,
        reason: f.reason,
        workflowRef: f.workflow
          ? { instanceBaseUrl: f.workflow.instance.baseUrl, externalId: f.workflow.externalId }
          : null,
        familyKey: f.familyKey,
        familyWorkflowRef: f.familyWorkflowId ? (familyRefById.get(f.familyWorkflowId) ?? null) : null,
      })),
      workflowGroups: groups.map((g) => ({
        instanceBaseUrl: g.instance.baseUrl,
        name: g.name,
        workflowN8nIds: g.workflows.map((w) => w.externalId),
      })),
      workflowLinks: links.map((l) => ({
        from: { instanceBaseUrl: l.from.instance.baseUrl, externalId: l.from.externalId },
        to: { instanceBaseUrl: l.to.instance.baseUrl, externalId: l.to.externalId },
        label: l.label,
        note: l.note,
      })),
    };
  }
}
