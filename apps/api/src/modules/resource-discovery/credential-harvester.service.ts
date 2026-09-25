import { Injectable } from '@nestjs/common';
import { N8nWorkflow, credentialSightings } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';

import { DISCOVERY_PROVIDERS } from './provider-catalog';

export interface CredentialUsage {
  workflowId: string;
  workflowName: string;
  nodeNames: string[];
}

export interface HarvestedCredential {
  type: string;
  id: string;
  name?: string;
  /** Nombre de nœuds qui utilisent ce credential dans les workflows snapshotés. */
  usedBy: number;
  /** Détail par workflow (dans le périmètre des filtres). */
  usages: CredentialUsage[];
}

@Injectable()
export class CredentialHarvesterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
  ) {}

  /**
   * L'API publique n8n ne permet pas de lister les credentials : on récolte
   * les paires {id, name} présentes dans les nœuds des workflows snapshotés.
   *
   * La traversée elle-même est dans le domaine (`credentialSightings`) : ce module
   * est désactivable, et l'assistant IA pose la même question pour choisir la
   * credential d'un nœud qu'il ajoute. Deux traversées auraient divergé.
   */
  async harvest(filters: {
    instanceId?: string;
    provider?: string;
    groupId?: string;
  }): Promise<HarvestedCredential[]> {
    const wantedTypes = filters.provider
      ? (DISCOVERY_PROVIDERS.find((p) => p.provider === filters.provider)?.credentialTypes ?? [])
      : undefined;

    const workflows = await this.prisma.workflow.findMany({
      where: {
        ...(filters.instanceId ? { instanceId: filters.instanceId } : {}),
        ...(filters.groupId ? { groups: { some: { id: filters.groupId } } } : {}),
        ...(await this.settings.workflowFilter()),
      },
      select: { id: true, name: true, raw: true },
    });

    const found = new Map<string, HarvestedCredential>();
    for (const workflow of workflows) {
      for (const { type, id, name, nodeName } of credentialSightings(
        workflow.raw as unknown as N8nWorkflow,
      )) {
        if (wantedTypes && !wantedTypes.includes(type)) continue;
        const key = `${type}:${id}`;
        let entry = found.get(key);
        if (!entry) {
          entry = { type, id, name, usedBy: 0, usages: [] };
          found.set(key, entry);
        }
        entry.usedBy += 1;
        let usage = entry.usages.find((u) => u.workflowId === workflow.id);
        if (!usage) {
          usage = { workflowId: workflow.id, workflowName: workflow.name, nodeNames: [] };
          entry.usages.push(usage);
        }
        if (!usage.nodeNames.includes(nodeName)) usage.nodeNames.push(nodeName);
      }
    }
    return [...found.values()].sort((a, b) => b.usedBy - a.usedBy);
  }
}
