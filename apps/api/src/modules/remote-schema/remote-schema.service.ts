import { Injectable } from '@nestjs/common';
import { RemoteSchemaReport, isModuleFullyDisabled } from '@nwm/core';
import { Finding } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CheckProfilesService } from '../../infra/check-profiles/check-profiles.service';
import { RemoteSchemaCheckService } from '../../infra/remote-schema/remote-schema-check.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { FindingIgnoreService } from '../workflows/finding-ignore.service';
import { InstancesService } from '../instances/instances.service';
import { REMOTE_SCHEMA_MANIFEST } from './manifest';

export interface RemoteSchemaRunResult {
  report: Omit<RemoteSchemaReport, 'findings'>;
  findings: Finding[];
}

/**
 * Contrôle lancé depuis la page d'un workflow : ses tables, lues sur SA propre
 * instance avec SES credentials. La promotion joue le même contrôle contre la
 * cible, sans rien persister (`InstancePromoterService`).
 */
@Injectable()
export class RemoteSchemaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowsService,
    private readonly instances: InstancesService,
    private readonly ignores: FindingIgnoreService,
    private readonly profiles: CheckProfilesService,
    private readonly checker: RemoteSchemaCheckService,
  ) {}

  /** `disabledChecks` : sélection de l'écran de lancement, prioritaire sur le profil. */
  async run(workflowId: string, disabledChecks?: string[]): Promise<RemoteSchemaRunResult> {
    const module = REMOTE_SCHEMA_MANIFEST.id;
    const disabled = await this.profiles.effective(workflowId, disabledChecks);
    // Tout décoché : pas de sonde n8n, mais les anciens findings partent — un
    // contrôle retiré ne doit pas continuer à s'afficher.
    if (isModuleFullyDisabled(disabled, 'remote-schema')) {
      await this.prisma.finding.deleteMany({ where: { workflowId, module } });
      return { report: { tables: [], unlocatable: [] }, findings: [] };
    }

    const { workflow, raw } = await this.workflows.getRaw(workflowId);
    const config = await this.instances.getConfig(workflow.instanceId);
    // Lancé par un humain : une sonde en échec reste dans n8n pour qu'il puisse l'ouvrir.
    const { findings: found, ...report } = await this.checker.check(config, raw, { keepOnError: true });

    const off = new Set(disabled);
    const { kept } = await this.ignores.filterIgnored(
      workflow.id,
      module,
      found.filter((finding) => !off.has(finding.code)),
    );
    await this.prisma.finding.deleteMany({ where: { workflowId, module } });
    await this.prisma.finding.createMany({
      data: kept.map((finding) => ({
        workflowId,
        module,
        severity: finding.severity,
        code: finding.code,
        message: finding.message,
        nodeName: finding.nodeName,
        data: (finding.data ?? {}) as object,
      })),
    });
    const findings = await this.prisma.finding.findMany({ where: { workflowId, module } });
    await this.prisma.analysisRun.create({ data: { workflowId, module, findingsCount: findings.length } });
    return { report, findings };
  }
}
