import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CheckProfile } from '@prisma/client';
import {
  CHECK_SCOPES,
  CheckModuleId,
  CheckProfileLike,
  CheckScope,
  SaveDecision,
  decideSaveScope,
  isModuleFullyDisabled,
  msg,
  normalizeDisabled,
  resolveCheckProfile,
  sameSelection,
  workflowFamilyKey,
} from '@nwm/core';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformSettingsService } from '../settings/platform-settings.service';

/** Contexte d'un workflow pour la résolution : ce qui définit ses périmètres. */
interface WorkflowContext {
  workflowId: string;
  instanceId: string;
  familyKey: string;
  /** Ids des workflows de la même famille (tous envs) : ancres possibles. */
  familyIds: string[];
  groupIds: string[];
}

export interface ProfileSource {
  scope: CheckScope;
  targetId: string;
  /** Nom du périmètre, pour l'afficher tel quel (« hérité de : instance Prod »). */
  label: string;
}

export interface ResolvedProfileView {
  disabled: string[];
  source: ProfileSource | null;
  /** Périmètres où l'on peut enregistrer pour CE workflow, du plus précis au plus large. */
  targets: Array<{ scope: CheckScope; targetId: string; label: string }>;
}

export interface ApplyResult {
  decision: SaveDecision;
  /** Profil enregistré, quand la décision ne demandait pas l'avis de l'utilisateur. */
  saved: ProfileSource | null;
}

/**
 * Profils de contrôles : quelle sélection de checks s'applique à un workflow, et
 * où l'enregistrer. Le domaine (`check-profile.ts`) porte la résolution et la
 * règle de portée ; ce service ne fait que lui apporter l'état de la base.
 *
 * Global (infra) et non module métier : les quatre modules d'analyse s'en
 * servent, et un module désactivable ne peut pas être leur dépendance commune.
 */
@Injectable()
export class CheckProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
  ) {}

  /** Profils enregistrés, chacun avec le nom de son périmètre (page de gestion). */
  async list(): Promise<Array<CheckProfile & { label: string }>> {
    const profiles = await this.prisma.checkProfile.findMany({ orderBy: { updatedAt: 'desc' } });
    return Promise.all(
      profiles.map(async (profile) => ({
        ...profile,
        label: (await this.describe(profile.scope as CheckScope, profile.targetId)).label,
      })),
    );
  }

  /**
   * Sélection qui s'applique à un workflow. `override` est la sélection composée
   * dans l'écran de lancement et pas encore enregistrée : elle prime, sinon
   * décocher un contrôle n'aurait d'effet qu'après avoir choisi une portée.
   */
  async effective(workflowId: string, override?: readonly string[]): Promise<string[]> {
    if (override) return normalizeDisabled(override);
    const { disabled } = await this.resolve(workflowId);
    return disabled;
  }

  /** Raccourci des modules d'analyse : ce module a-t-il encore quelque chose à chercher ? */
  async isModuleOff(
    workflowId: string,
    module: CheckModuleId,
    override?: readonly string[],
  ): Promise<boolean> {
    return isModuleFullyDisabled(await this.effective(workflowId, override), module);
  }

  async resolve(workflowId: string): Promise<ResolvedProfileView> {
    const context = await this.contextOf(workflowId);
    const profiles = await this.applicableProfiles(context);
    const { disabled, source } = resolveCheckProfile(profiles);
    const targets = await this.targetsOf(context);
    return {
      disabled,
      source: source ? await this.describe(source.scope, source.targetId) : null,
      targets,
    };
  }

  /** Où enregistrer cette sélection, sans rien écrire (prévisualisation de l'UI). */
  async plan(workflowId: string, selection: readonly string[]): Promise<SaveDecision> {
    const context = await this.contextOf(workflowId);
    return this.decide(context, selection);
  }

  /**
   * Enregistre une sélection. Sans `scope`, la portée est décidée par le domaine :
   * soit elle s'impose (première configuration, ou exception de ce workflow) et
   * l'écriture a lieu, soit la sélection se répète ailleurs et la décision revient
   * à l'utilisateur — rien n'est alors écrit, l'UI rappelle avec une portée.
   */
  async apply(workflowId: string, selection: readonly string[], scope?: CheckScope): Promise<ApplyResult> {
    const context = await this.contextOf(workflowId);
    if (scope) {
      const saved = await this.saveAt(context, scope, selection);
      return { decision: { action: 'auto', scope, notice: '' }, saved };
    }
    const decision = await this.decide(context, selection);
    if (decision.action === 'auto') {
      return { decision, saved: await this.saveAt(context, decision.scope, selection) };
    }
    return { decision, saved: null };
  }

  async remove(id: string): Promise<CheckProfile> {
    const profile = await this.prisma.checkProfile.findUnique({ where: { id } });
    if (!profile) throw new NotFoundException(msg('analysis.profileNotFound', { id }));
    return this.prisma.checkProfile.delete({ where: { id } });
  }

  private async decide(context: WorkflowContext, selection: readonly string[]): Promise<SaveDecision> {
    const [profiles, total, twinFamilies] = await Promise.all([
      this.applicableProfiles(context),
      this.prisma.checkProfile.count(),
      this.countTwinFamilies(context, selection),
    ]);
    return decideSaveScope({
      selection,
      resolved: resolveCheckProfile(profiles),
      hasAnyProfile: total > 0,
      twinFamilies,
      hasGroup: context.groupIds.length > 0,
    });
  }

  /**
   * Familles AUTRES que celle-ci portant déjà exactement cette sélection, par
   * périmètre. C'est la répétition — deux workflows réglés pareil — qui fait
   * proposer un enregistrement plus haut.
   */
  private async countTwinFamilies(
    context: WorkflowContext,
    selection: readonly string[],
  ): Promise<{ group: number; instance: number; anywhere: number }> {
    const families = await this.prisma.checkProfile.findMany({ where: { scope: 'family' } });
    const twins = families.filter(
      (profile) =>
        !context.familyIds.includes(profile.targetId) &&
        profile.familyKey !== context.familyKey &&
        sameSelection(profile.disabled, selection),
    );
    if (twins.length === 0) return { group: 0, instance: 0, anywhere: 0 };

    const anchors = await this.prisma.workflow.findMany({
      where: { id: { in: twins.map((profile) => profile.targetId) } },
      select: { id: true, instanceId: true, groups: { select: { id: true } } },
    });
    const groups = new Set(context.groupIds);
    return {
      group: anchors.filter((w) => w.groups.some((group) => groups.has(group.id))).length,
      instance: anchors.filter((w) => w.instanceId === context.instanceId).length,
      anywhere: twins.length,
    };
  }

  private async saveAt(
    context: WorkflowContext,
    scope: CheckScope,
    selection: readonly string[],
  ): Promise<ProfileSource> {
    const targetId = this.targetIdFor(context, scope);
    const disabled = normalizeDisabled(selection);
    await this.prisma.checkProfile.upsert({
      where: { scope_targetId: { scope, targetId } },
      create: {
        scope,
        targetId,
        familyKey: scope === 'family' ? context.familyKey : null,
        disabled,
      },
      update: { disabled, familyKey: scope === 'family' ? context.familyKey : null },
    });
    await this.pruneSubsumed(scope, targetId, disabled);
    return this.describe(scope, targetId);
  }

  /**
   * Après une remontée de portée, les profils plus précis qui disaient déjà la
   * même chose sont retirés : les garder ferait mentir l'origine affichée
   * (« ce workflow ») et rendrait la remontée sans effet visible.
   */
  private async pruneSubsumed(scope: CheckScope, targetId: string, disabled: string[]): Promise<void> {
    if (scope === 'family') return;
    const narrower = CHECK_SCOPES.slice(0, CHECK_SCOPES.indexOf(scope));
    const candidates = await this.prisma.checkProfile.findMany({
      where: { scope: { in: narrower } },
    });
    const redundant: string[] = [];
    for (const profile of candidates) {
      if (!sameSelection(profile.disabled, disabled)) continue;
      if (await this.isInside(profile, scope, targetId)) redundant.push(profile.id);
    }
    if (redundant.length > 0) {
      await this.prisma.checkProfile.deleteMany({ where: { id: { in: redundant } } });
    }
  }

  /** Le périmètre d'un profil est-il contenu dans (scope, targetId) ? */
  private async isInside(profile: CheckProfile, scope: CheckScope, targetId: string): Promise<boolean> {
    if (scope === 'global') return true;
    if (profile.scope === 'family') {
      const anchor = await this.prisma.workflow.findUnique({
        where: { id: profile.targetId },
        select: { instanceId: true, groups: { select: { id: true } } },
      });
      if (!anchor) return false;
      return scope === 'instance'
        ? anchor.instanceId === targetId
        : anchor.groups.some((group) => group.id === targetId);
    }
    if (profile.scope === 'group' && scope === 'instance') {
      const group = await this.prisma.workflowGroup.findUnique({
        where: { id: profile.targetId },
        select: { instanceId: true },
      });
      return group?.instanceId === targetId;
    }
    return false;
  }

  private targetIdFor(context: WorkflowContext, scope: CheckScope): string {
    switch (scope) {
      case 'global':
        return '';
      case 'instance':
        return context.instanceId;
      case 'group':
        if (context.groupIds.length === 0) {
          throw new BadRequestException(msg('analysis.profileNoGroup'));
        }
        return context.groupIds[0];
      case 'family':
        return context.workflowId;
    }
  }

  private async contextOf(workflowId: string): Promise<WorkflowContext> {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
      select: { id: true, name: true, instanceId: true, groups: { select: { id: true } } },
    });
    if (!workflow) throw new NotFoundException(msg('analysis.profileWorkflowNotFound', { id: workflowId }));
    const envs = await this.settings.declaredEnvIds();
    const familyKey = workflowFamilyKey(workflow.name, envs);
    // La famille se calcule sur les noms COURANTS : un profil ancré sur l'un de
    // ces workflows suit donc les renommages, au lieu de rester sur un nom mort.
    const all = await this.prisma.workflow.findMany({ select: { id: true, name: true } });
    return {
      workflowId,
      instanceId: workflow.instanceId,
      familyKey,
      familyIds: all.filter((w) => workflowFamilyKey(w.name, envs) === familyKey).map((w) => w.id),
      groupIds: workflow.groups.map((group) => group.id),
    };
  }

  private async applicableProfiles(context: WorkflowContext): Promise<CheckProfileLike[]> {
    const profiles = await this.prisma.checkProfile.findMany({
      where: {
        OR: [
          { scope: 'global' },
          { scope: 'instance', targetId: context.instanceId },
          ...(context.groupIds.length > 0 ? [{ scope: 'group', targetId: { in: context.groupIds } }] : []),
          { scope: 'family', targetId: { in: context.familyIds } },
          { scope: 'family', familyKey: context.familyKey },
        ],
      },
    });
    return profiles.map((profile) => ({
      scope: profile.scope as CheckScope,
      targetId: profile.targetId,
      disabled: profile.disabled,
      updatedAt: profile.updatedAt,
    }));
  }

  private async targetsOf(context: WorkflowContext): Promise<ResolvedProfileView['targets']> {
    const scopes: CheckScope[] =
      context.groupIds.length > 0
        ? ['family', 'group', 'instance', 'global']
        : ['family', 'instance', 'global'];
    return Promise.all(scopes.map(async (scope) => this.describe(scope, this.targetIdFor(context, scope))));
  }

  /** Nomme un périmètre pour l'UI : « ce workflow », « instance Prod », « groupe Facturation ». */
  private async describe(scope: CheckScope, targetId: string): Promise<ProfileSource> {
    if (scope === 'global') return { scope, targetId: '', label: msg('analysis.scopeGlobal') };
    if (scope === 'instance') {
      const instance = await this.prisma.instance.findUnique({
        where: { id: targetId },
        select: { name: true },
      });
      return {
        scope,
        targetId,
        label: instance
          ? msg('analysis.scopeInstance', { name: instance.name })
          : msg('analysis.scopeInstanceDeleted'),
      };
    }
    if (scope === 'group') {
      const group = await this.prisma.workflowGroup.findUnique({
        where: { id: targetId },
        select: { name: true },
      });
      return {
        scope,
        targetId,
        label: group ? msg('analysis.scopeGroup', { name: group.name }) : msg('analysis.scopeGroupDeleted'),
      };
    }
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: targetId },
      select: { name: true },
    });
    return {
      scope,
      targetId,
      label: workflow
        ? msg('analysis.scopeFamily', { name: workflow.name })
        : msg('analysis.scopeFamilyDeleted'),
    };
  }
}
