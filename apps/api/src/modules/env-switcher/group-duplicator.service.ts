import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  EnvName,
  N8N_API_PORT,
  N8nApiPort,
  N8nWorkflow,
  Replacement,
  SubWorkflowTarget,
  applyDeepReplace,
  extractSubWorkflowRefs,
  previewDeepReplace,
  remapSubWorkflowRefs,
  withEnvSuffix,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { InstancesService } from '../instances/instances.service';
import { WorkflowSyncService } from '../workflows/workflow-sync.service';
import { SwitchedResource, previewCopy } from './copy-preview';
import { EnvDuplicatorService } from './env-duplicator.service';
import { buildReplacements } from './mapping-replacements';
import { toSwitchMappings } from './switch-resources';
import { UnmappedResource } from './unmapped-resources';

export interface GroupCopyResult {
  sourceWorkflowId: string;
  sourceName: string;
  newName: string;
  newN8nId?: string;
  localWorkflowId?: string;
  /** Remplacements de ressources (mappings) appliqués sur la copie. */
  replacements: number;
  /** Ressources basculées dont le nom affiché a changé, par nœud. */
  switched: SwitchedResource[];
  /** Références workflow→workflow internes au groupe re-câblées vers les copies. */
  rewired: number;
}

export interface GroupDuplicateResult {
  groupId: string;
  groupName: string;
  targetEnv: EnvName;
  /** Groupe créé/complété avec les copies (nom suffixé par l'env). */
  targetGroupId?: string;
  targetGroupName: string;
  copies: GroupCopyResult[];
}

/** Ce qu'une duplication de groupe ferait, membre par membre, avant de rien écrire. */
export interface GroupCopyPreview {
  workflowId: string;
  name: string;
  /** Nom que portera la copie (nom suffixé par l'env cible). */
  targetName: string;
  /** Une copie porte DÉJÀ ce nom sur l'instance : en dupliquer une seconde ferait un doublon. */
  alreadyExists: boolean;
  /** Le membre EST déjà dans l'env cible : la copie porterait son propre nom. */
  sameAsSource: boolean;
  active: boolean;
  archived: boolean;
  /** Nombre de valeurs de ressources que les mappings basculeront. */
  replacements: number;
  /** Ressources basculées dont le nom affiché change, par nœud. */
  switched: SwitchedResource[];
  /** Ressources qu'aucun mapping ne couvre : la copie restera branchée sur celles de la source. */
  unmapped: UnmappedResource[];
  /** Appels vers des workflows du groupe : ils seront re-câblés vers les copies. */
  internalCalls: string[];
  /** Appels vers des workflows HORS du groupe : la copie continuera de les appeler tels quels. */
  externalCalls: string[];
}

export interface GroupDuplicatePreview {
  groupId: string;
  groupName: string;
  targetEnv: EnvName;
  targetGroupName: string;
  /** Le groupe cible existe déjà : les copies s'y ajouteront. */
  targetGroupExists: boolean;
  copies: GroupCopyPreview[];
  /** Membres dont une copie existe déjà : c'est ce qui exige une confirmation explicite. */
  duplicateCount: number;
}

/**
 * "Dupliquer un groupe vers env" : clone chaque workflow membre (via EnvDuplicator),
 * puis re-câble les appels internes au groupe (Execute Workflow…) pour que les copies
 * s'appellent entre elles — et non les originaux. Les copies sont rattachées à un
 * groupe cible "<nom> - ENV" pour pouvoir re-scanner / re-dupliquer l'ensemble.
 */
@Injectable()
export class GroupDuplicatorService {
  private readonly logger = new Logger(GroupDuplicatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly duplicator: EnvDuplicatorService,
    private readonly instances: InstancesService,
    private readonly sync: WorkflowSyncService,
    @Inject(N8N_API_PORT) private readonly n8n: N8nApiPort,
    private readonly settings: PlatformSettingsService,
  ) {}

  /**
   * Plan de la duplication, sans rien écrire. Un seul workflow avait droit à son
   * écran d'impact avant d'être copié ; en dupliquer huit d'un coup se faisait sur
   * un select et un « ok », alors que c'est justement le geste le plus large.
   *
   * Le point qui compte est `alreadyExists` : la duplication CRÉE, elle n'apparie
   * pas, donc la relancer sur un groupe déjà dupliqué double chaque workflow —
   * silencieusement, avec des noms identiques dans n8n.
   */
  async previewGroup(groupId: string, targetEnv: EnvName): Promise<GroupDuplicatePreview> {
    const group = await this.loadGroup(groupId);
    const config = await this.instances.getConfig(group.instanceId);
    const envs = await this.settings.declaredEnvIds();
    const existingNames = new Set((await this.n8n.listWorkflows(config)).map((w) => w.name));
    const mappings = toSwitchMappings(await this.prisma.resourceMapping.findMany());
    const replacements = mappings.flatMap((mapping) => buildReplacements(mapping.values, targetEnv));
    const memberIds = new Set(group.workflows.map((member) => member.externalId));
    const memberNames = new Map(group.workflows.map((member) => [member.externalId, member.name] as const));

    const context = {
      targetEnv,
      envs,
      existingNames,
      replacements,
      mappings,
    };

    const copies: GroupCopyPreview[] = group.workflows.map((member) => {
      const raw = member.raw as unknown as N8nWorkflow | null;
      const refs = raw ? extractSubWorkflowRefs(raw) : [];
      return {
        workflowId: member.id,
        name: member.name,
        ...previewCopy({ name: member.name, raw }, context),
        active: member.active,
        archived: member.archivedUpstream,
        internalCalls: refs
          .filter((ref) => !ref.dynamic && memberIds.has(ref.externalId))
          .map((ref) => memberNames.get(ref.externalId) ?? ref.nodeName),
        externalCalls: refs
          .filter((ref) => !ref.dynamic && !memberIds.has(ref.externalId))
          .map((ref) => ref.nodeName),
      };
    });

    const targetGroupName = withEnvSuffix(group.name, targetEnv, envs);
    return {
      groupId: group.id,
      groupName: group.name,
      targetEnv,
      targetGroupName,
      targetGroupExists:
        (await this.prisma.workflowGroup.count({
          where: { instanceId: group.instanceId, name: targetGroupName },
        })) > 0,
      copies,
      duplicateCount: copies.filter((copy) => copy.alreadyExists).length,
    };
  }

  /**
   * `force` : dupliquer alors qu'une copie porte déjà le nom cible. Rien ne
   * l'interdit techniquement — n8n accepte deux workflows homonymes — mais
   * personne ne le veut par accident, et c'est le résultat par défaut d'un
   * second clic sur le même bouton.
   */
  async duplicateGroup(
    groupId: string,
    targetEnv: EnvName,
    options: { force?: boolean } = {},
  ): Promise<GroupDuplicateResult> {
    const group = await this.loadGroup(groupId);
    const config = await this.instances.getConfig(group.instanceId);

    const envs = await this.settings.declaredEnvIds();
    if (!options.force) {
      const existingNames = new Set((await this.n8n.listWorkflows(config)).map((w) => w.name));
      const doubles = group.workflows.filter((member) =>
        existingNames.has(withEnvSuffix(member.name, targetEnv, envs)),
      );
      if (doubles.length > 0) {
        throw new BadRequestException(
          `${doubles.length} copie(s) portent déjà le nom cible (${doubles
            .map((member) => withEnvSuffix(member.name, targetEnv, envs))
            .join(
              ', ',
            )}) : dupliquer en créerait une seconde. Coche « dupliquer quand même » pour passer outre.`,
        );
      }
    }

    // Passe 1 : duplication de chaque membre (ressources basculées, nom suffixé, tag env:<cible>)
    const copies: GroupCopyResult[] = [];
    const idMap = new Map<string, string>();
    // Cibles nommées : réécrire le `workflowId` d'un Execute Workflow remet aussi à jour
    // le nom que n8n affiche dessus, qu'un simple remplacement d'id laisserait périmé.
    const subTargets = new Map<string, SubWorkflowTarget>();
    for (const member of group.workflows) {
      const result = await this.duplicator.duplicateToEnv(member.id, targetEnv);
      copies.push({
        sourceWorkflowId: member.id,
        sourceName: member.name,
        newName: result.newName,
        newN8nId: result.newN8nId,
        localWorkflowId: result.localWorkflowId,
        replacements: result.replacements,
        switched: result.switched,
        rewired: 0,
      });
      if (result.newN8nId) {
        idMap.set(member.externalId, result.newN8nId);
        subTargets.set(member.externalId, { externalId: result.newN8nId, name: result.newName });
      }
    }

    // Passe 2 : re-câblage des références internes au groupe (id n8n original → id de la copie).
    // Sans elle, une copie dev appellerait encore les workflows d'origine (mélange d'envs).
    const rewires: Replacement[] = [...idMap.entries()].map(([from, to]) => ({ from, to }));
    for (const copy of copies) {
      if (!copy.newN8nId) continue;
      const fresh = await this.n8n.getWorkflow(config, copy.newN8nId);
      const remapped = remapSubWorkflowRefs(fresh as N8nWorkflow, subTargets);
      const hits = previewDeepReplace(remapped.workflow, rewires);
      if (hits.length === 0 && remapped.rewrites.length === 0) continue;
      const rewired = applyDeepReplace(remapped.workflow, rewires);
      await this.n8n.updateWorkflow(config, copy.newN8nId, rewired);
      copy.rewired = hits.length + remapped.rewrites.length;
      const updated = await this.n8n.getWorkflow(config, copy.newN8nId);
      await this.sync.upsertWorkflow(group.instanceId, updated);
    }

    // Passe 3 : groupe cible contenant les copies (connect cumulatif : re-dupliquer complète le groupe)
    const targetGroupName = withEnvSuffix(group.name, targetEnv, envs);
    const localIds = copies
      .map((copy) => copy.localWorkflowId)
      .filter((id): id is string => Boolean(id))
      .map((id) => ({ id }));
    let targetGroupId: string | undefined;
    try {
      const target = await this.prisma.workflowGroup.upsert({
        where: { instanceId_name: { instanceId: group.instanceId, name: targetGroupName } },
        create: { instanceId: group.instanceId, name: targetGroupName, workflows: { connect: localIds } },
        update: { workflows: { connect: localIds } },
      });
      targetGroupId = target.id;
    } catch (error) {
      this.logger.warn(`Groupe cible "${targetGroupName}" KO : ${(error as Error).message}`);
    }

    const rewiredTotal = copies.reduce((sum, copy) => sum + copy.rewired, 0);
    this.logger.log(
      `Groupe "${group.name}" dupliqué vers ${targetEnv} : ${copies.length} copies, ${rewiredTotal} référence(s) interne(s) re-câblée(s)`,
    );
    return {
      groupId: group.id,
      groupName: group.name,
      targetEnv,
      targetGroupId,
      targetGroupName,
      copies,
    };
  }

  private async loadGroup(groupId: string) {
    const group = await this.prisma.workflowGroup.findUnique({
      where: { id: groupId },
      include: {
        workflows: {
          select: { id: true, externalId: true, name: true, active: true, archivedUpstream: true, raw: true },
          orderBy: { name: 'asc' },
        },
      },
    });
    if (!group) throw new NotFoundException(`Groupe ${groupId} inconnu`);
    if (group.workflows.length === 0) throw new BadRequestException('Le groupe ne contient aucun workflow');
    return group;
  }
}
