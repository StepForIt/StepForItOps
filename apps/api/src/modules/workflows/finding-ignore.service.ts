import { Injectable, NotFoundException } from '@nestjs/common';
import { FindingIgnore, Prisma } from '@prisma/client';
import { N8nWorkflow, findingIgnoreCovers, findingMessageKey, workflowFamilyKey } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';

/**
 * Portée d'une règle, de la plus étroite à la plus large : ce workflow seul,
 * le même workflow métier dans tous ses environnements, ou tous les workflows.
 */
export type IgnoreScope = 'workflow' | 'family' | 'global';
/** Portée nœud : ce nœud seulement, ou n'importe quel nœud. */
export type IgnoreNodeScope = 'node' | 'any-node';

export interface CreateIgnoreInput {
  module: string;
  code: string;
  workflowId?: string | null;
  /** Clé de famille (dev/preprod/prod du même workflow métier) ; exclusive de workflowId. */
  familyKey?: string | null;
  /** Workflow d'ancrage de la portée famille : c'est lui qui fait foi après un renommage. */
  familyWorkflowId?: string | null;
  nodeName?: string | null;
  /** Id n8n du nœud visé : survit à un renommage, contrairement au nom. */
  nodeId?: string | null;
  /** Message du finding d'origine (mémo humain + matière pour les revues IA). */
  message?: string | null;
  reason?: string | null;
}

/** Une règle telle qu'on la donne à une revue IA : « ceci est normal, ne le resignale pas ». */
export interface IgnoredRuleHint {
  code: string;
  nodeName: string | null;
  message: string;
  reason: string | null;
}

/**
 * Règles d'exclusion de findings : un finding « normal et voulu » (placeholder,
 * convention maison…) est masqué durablement, y compris après ré-analyse.
 */
@Injectable()
export class FindingIgnoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
  ) {}

  list(where: Prisma.FindingIgnoreWhereInput, args: Prisma.FindingIgnoreFindManyArgs = {}) {
    return this.prisma.findingIgnore.findMany({
      where,
      ...args,
      include: { workflow: { select: { name: true } } },
    });
  }

  count(where: Prisma.FindingIgnoreWhereInput): Promise<number> {
    return this.prisma.findingIgnore.count({ where });
  }

  /**
   * Règles applicables à un workflow : les siennes, celles de sa famille
   * (mêmes règles dans tous ses environnements) et les règles globales.
   *
   * Une règle « famille » s'apparie par son workflow d'ancrage quand elle en a un :
   * la familyKey est dérivée du NOM, donc un renommage la périmait en silence et le
   * finding déclaré normal revenait. Les règles antérieures à l'ancrage s'apparient
   * encore par familyKey — et on leur pose l'ancre au passage, une fois pour toutes.
   */
  async rulesFor(workflowId: string, module: string): Promise<FindingIgnore[]> {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
      select: { name: true },
    });
    const envs = await this.settings.declaredEnvIds();
    const familyKey = workflow ? workflowFamilyKey(workflow.name, envs) : null;
    // Famille calculée sur les noms COURANTS : une règle ancrée sur l'un de ces
    // workflows suit donc les renommages, au lieu de rester collée à un nom mort.
    const familyIds = familyKey ? await this.workflowIdsInFamily(familyKey) : [];

    const rules = await this.prisma.findingIgnore.findMany({
      where: {
        module,
        OR: [
          { workflowId },
          ...(familyIds.length > 0 ? [{ familyWorkflowId: { in: familyIds } }] : []),
          ...(familyKey ? [{ familyKey, familyWorkflowId: null }] : []),
          { workflowId: null, familyKey: null, familyWorkflowId: null },
        ],
      },
    });

    await this.healFamilyRules(rules, workflowId, familyKey);
    return rules;
  }

  /**
   * Remet d'aplomb les règles « famille » croisées au passage : celles d'avant
   * l'ancrage reçoivent leur ancre, et celles dont la clé date d'avant un renommage
   * sont recalées sur le nom courant — sinon la page des findings ignorés continue
   * d'afficher une portée qui n'existe plus. Écriture dans un chemin de lecture,
   * assumée : c'est le seul moment où l'on tient la règle ET un workflow de sa
   * famille, et chaque règle n'y passe qu'une fois.
   */
  private async healFamilyRules(
    rules: FindingIgnore[],
    workflowId: string,
    familyKey: string | null,
  ): Promise<void> {
    const orphans = rules.filter((rule) => rule.familyKey && !rule.familyWorkflowId);
    if (orphans.length > 0) {
      await this.prisma.findingIgnore.updateMany({
        where: { id: { in: orphans.map((rule) => rule.id) } },
        data: { familyWorkflowId: workflowId },
      });
    }
    const drifted = rules.filter(
      (rule) => rule.familyWorkflowId && familyKey !== null && rule.familyKey !== familyKey,
    );
    if (drifted.length > 0) {
      await this.prisma.findingIgnore.updateMany({
        where: { id: { in: drifted.map((rule) => rule.id) } },
        data: { familyKey },
      });
    }
  }

  /** Ids des workflows d'une famille : Postgres ne sait pas calculer la clé, le domaine si. */
  private async workflowIdsInFamily(familyKey: string): Promise<string[]> {
    const envs = await this.settings.declaredEnvIds();
    const workflows = await this.prisma.workflow.findMany({ select: { id: true, name: true } });
    return workflows.filter((w) => workflowFamilyKey(w.name, envs) === familyKey).map((w) => w.id);
  }

  /**
   * Retire des findings ceux couverts par une règle.
   * Appelé par chaque module d'analyse AVANT persistance : les findings ignorés
   * n'existent donc jamais en base (compteurs et couverture restent cohérents).
   */
  async filterIgnored<T extends { code: string; nodeName?: string | null; message?: string }>(
    workflowId: string,
    module: string,
    findings: T[],
  ): Promise<{ kept: T[]; ignoredCount: number }> {
    if (findings.length === 0) return { kept: findings, ignoredCount: 0 };
    const rules = await this.rulesFor(workflowId, module);
    if (rules.length === 0) return { kept: findings, ignoredCount: 0 };
    const nodeIdByName = rules.some((rule) => rule.nodeId)
      ? await this.nodeIdsByName(workflowId)
      : new Map<string, string>();
    const kept = findings.filter(
      (finding) => !rules.some((rule) => findingIgnoreCovers(rule, finding, nodeIdByName)),
    );
    return { kept, ignoredCount: findings.length - kept.length };
  }

  /**
   * Règles à rappeler à une revue IA. Le post-filtre suffit à ne pas AFFICHER un
   * finding déclaré normal, mais l'IA le cherche et le rédige quand même à chaque
   * passe : du temps et des tokens dépensés pour une remarque jetée juste après.
   * Seules les règles portant le message d'origine sont exploitables — un code seul
   * (`ai-logic`) ne dit rien de ce qui a été déclaré normal.
   */
  async hintsFor(workflowId: string, module: string): Promise<IgnoredRuleHint[]> {
    const rules = await this.rulesFor(workflowId, module);
    return rules
      .filter((rule): rule is FindingIgnore & { message: string } => Boolean(rule.message))
      .map((rule) => ({
        code: rule.code,
        nodeName: rule.nodeName,
        message: rule.message,
        reason: rule.reason,
      }));
  }

  /** Nom → id n8n des nœuds du workflow : c'est l'id que suit une règle après un renommage. */
  private async nodeIdsByName(workflowId: string): Promise<Map<string, string>> {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
      select: { raw: true },
    });
    const raw = workflow?.raw as unknown as N8nWorkflow | undefined;
    const entries = (raw?.nodes ?? [])
      .filter((node) => node.id)
      .map((node) => [node.name, node.id!] as const);
    return new Map(entries);
  }

  /** Crée la règle (idempotent) et supprime les findings déjà en base qu'elle couvre. */
  async create(input: CreateIgnoreInput): Promise<FindingIgnore> {
    const key = {
      module: input.module,
      code: input.code,
      workflowId: input.workflowId ?? null,
      familyKey: input.familyKey ?? null,
      nodeName: input.nodeName ?? null,
    };
    const existing = await this.prisma.findingIgnore.findFirst({ where: key });
    const details = {
      familyWorkflowId: input.familyWorkflowId ?? null,
      nodeId: input.nodeId ?? null,
      message: input.message ?? null,
      messageKey: input.message ? findingMessageKey(input.message) : null,
    };
    const rule = existing
      ? // Règle d'avant l'ancrage recréée depuis l'UI : on la complète au lieu d'en
        // ouvrir une seconde, sinon la page des findings ignorés se peuple de doublons.
        await this.prisma.findingIgnore.update({
          where: { id: existing.id },
          data: {
            ...(existing.familyWorkflowId ? {} : { familyWorkflowId: details.familyWorkflowId }),
            ...(existing.nodeId ? {} : { nodeId: details.nodeId }),
            ...(existing.message ? {} : { message: details.message, messageKey: details.messageKey }),
            ...(existing.reason || !input.reason ? {} : { reason: input.reason }),
          },
        })
      : await this.prisma.findingIgnore.create({
          data: { ...key, ...details, reason: input.reason ?? null },
        });
    await this.prisma.finding.deleteMany({
      where: {
        module: rule.module,
        code: rule.code,
        ...(rule.workflowId ? { workflowId: rule.workflowId } : {}),
        ...(rule.familyKey ? { workflowId: { in: await this.workflowIdsInFamily(rule.familyKey) } } : {}),
        ...(rule.nodeName ? { nodeName: rule.nodeName } : {}),
      },
    });
    return rule;
  }

  /** Crée une règle à partir d'un finding existant (chemin UI « Ignorer »). */
  async createFromFinding(
    findingId: string,
    options: { scope?: IgnoreScope; nodeScope?: IgnoreNodeScope; reason?: string },
  ): Promise<FindingIgnore> {
    const finding = await this.prisma.finding.findUnique({
      where: { id: findingId },
      include: { workflow: { select: { name: true } } },
    });
    if (!finding) throw new NotFoundException(`Finding ${findingId} introuvable`);
    const scope = options.scope ?? 'family';
    const targetsNode = options.nodeScope !== 'any-node' && Boolean(finding.nodeName);
    const nodeIds = targetsNode ? await this.nodeIdsByName(finding.workflowId) : null;
    return this.create({
      module: finding.module,
      code: finding.code,
      workflowId: scope === 'workflow' ? finding.workflowId : null,
      familyKey:
        scope === 'family'
          ? workflowFamilyKey(finding.workflow.name, await this.settings.declaredEnvIds())
          : null,
      familyWorkflowId: scope === 'family' ? finding.workflowId : null,
      nodeName: targetsNode ? finding.nodeName : null,
      nodeId: targetsNode ? (nodeIds?.get(finding.nodeName!) ?? null) : null,
      message: finding.message,
      reason: options.reason,
    });
  }

  async remove(id: string): Promise<FindingIgnore> {
    const rule = await this.prisma.findingIgnore.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException(`Règle ${id} introuvable`);
    return this.prisma.findingIgnore.delete({ where: { id } });
  }
}
