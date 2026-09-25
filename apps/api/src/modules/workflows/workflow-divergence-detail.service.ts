import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EnvDivergenceStatus, N8nWorkflow, WorkflowDiff, deployDiff } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { WorkflowWithEnv, WorkflowsService } from './workflows.service';
import { WorkflowDivergenceService } from './workflow-divergence.service';

export interface DivergenceSide {
  id: string;
  name: string;
  env: string | null;
  instanceId: string;
  instanceName: string;
  n8nUrl: string;
  /** Dernière modification dans n8n : c'est elle qui décide du sens de l'écart. */
  upstreamUpdatedAt: Date | null;
  /** Dernière écriture du miroir local : le diff est calculé sur cette copie, pas sur n8n. */
  mirroredAt: Date;
}

export interface WorkflowDivergenceDetail {
  status: EnvDivergenceStatus;
  workflow: DivergenceSide;
  reference: DivergenceSide;
  /** Toutes les prods du workflow métier, quand il y en a plusieurs (deux instances). */
  references: Array<Pick<DivergenceSide, 'id' | 'name' | 'instanceName'>>;
  /** Avant = la prod telle qu'elle est ; après = ce qu'une promotion de cet exemplaire y poserait. */
  diff: WorkflowDiff;
}

/**
 * CE QUI diffère entre un exemplaire et la prod de son workflow métier — la colonne
 * « Écart prod » ne dit que QU'il diffère. Le diff porte sur les formes normalisées de
 * `deployKey`, calculées avec le même contexte que la colonne : un écart constaté a
 * toujours au moins une ligne à montrer, et rien de ce que la promotion neutralise
 * (ids mappés, paths de webhook, noms) n'y passe pour un écart.
 *
 * Lu sur le miroir local, jamais sur n8n : c'est ce miroir que la colonne compare, et
 * ouvrir l'écran ne doit pas coûter deux appels à n8n. La date du miroir est rendue.
 */
@Injectable()
export class WorkflowDivergenceDetailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowsService,
    private readonly divergence: WorkflowDivergenceService,
  ) {}

  async detail(id: string, referenceId?: string): Promise<WorkflowDivergenceDetail> {
    const workflow = await this.workflows.get(id);
    const divergence = (await this.divergence.statuses()).get(id);
    if (!divergence) {
      throw new NotFoundException(
        'Rien à comparer : cet exemplaire est lui-même la référence (prod), ou son environnement est indéterminé.',
      );
    }
    if (divergence.status === 'not-deployed') {
      throw new NotFoundException('Aucun exemplaire en prod pour ce workflow métier.');
    }
    if (divergence.status === 'unknown' || workflow.platform !== 'n8n') {
      throw new BadRequestException(
        'Contenu non comparable : cette plateforme n’a pas d’empreinte de déploiement.',
      );
    }

    const references = await Promise.all(divergence.referenceIds.map((refId) => this.workflows.get(refId)));
    const context = await this.divergence.keyContext();
    const diffWith = (reference: WorkflowWithEnv): WorkflowDiff =>
      deployDiff(
        {
          workflow: reference.raw as unknown as N8nWorkflow,
          context: context.forInstance(reference.instanceId),
        },
        {
          workflow: workflow.raw as unknown as N8nWorkflow,
          context: context.forInstance(workflow.instanceId),
        },
      );

    // Plusieurs prods : celle demandée, sinon la première qui diffère — c'est elle
    // qui a fait passer l'exemplaire pour « différent ».
    const diffs = references.map((reference) => ({ reference, diff: diffWith(reference) }));
    const chosen =
      diffs.find((entry) => entry.reference.id === referenceId) ??
      diffs.find((entry) => entry.diff.hasChanges) ??
      diffs[0];

    const instanceNames = await this.instanceNames([workflow, ...references]);
    const side = (row: WorkflowWithEnv): DivergenceSide => ({
      id: row.id,
      name: row.name,
      env: row.env,
      instanceId: row.instanceId,
      instanceName: instanceNames.get(row.instanceId) ?? '',
      n8nUrl: row.n8nUrl,
      upstreamUpdatedAt: row.upstreamUpdatedAt,
      mirroredAt: row.updatedAt,
    });
    return {
      status: divergence.status,
      workflow: side(workflow),
      reference: side(chosen.reference),
      references: references.map((row) => ({
        id: row.id,
        name: row.name,
        instanceName: instanceNames.get(row.instanceId) ?? '',
      })),
      diff: chosen.diff,
    };
  }

  private async instanceNames(rows: WorkflowWithEnv[]): Promise<Map<string, string>> {
    const instances = await this.prisma.instance.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.instanceId))] } },
      select: { id: true, name: true },
    });
    return new Map(instances.map((instance) => [instance.id, instance.name] as const));
  }
}
