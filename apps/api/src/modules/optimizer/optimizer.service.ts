import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  AI_PORT,
  AiPort,
  EVENTS,
  N8N_API_PORT,
  N8nApiPort,
  RenameSpec,
  N8nWorkflow,
  findMakeNamingIssues,
  isStickyNote,
  languageName,
  msg,
  redactSecrets,
  safeRenameNodes,
} from '@nwm/core';
import { Finding } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EnvChainGuardService } from '../../infra/settings/env-chain-guard.service';
import { EventBusService } from '../../infra/events/event-bus.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { WorkflowSyncService } from '../workflows/workflow-sync.service';
import { FindingIgnoreService } from '../workflows/finding-ignore.service';
import { CheckProfilesService } from '../../infra/check-profiles/check-profiles.service';
import { InstancesService } from '../instances/instances.service';
import { findNamingIssues } from './naming-rules';
import { findStickyIssues } from './sticky-rules';
import { MakeNamingService } from './make-naming.service';
import { WorkflowLockService } from '../../infra/workflow-lock/workflow-lock.service';
import { PlatformLocale } from '../../infra/i18n/platform-locale';

/** Renommage à appliquer, avec note optionnelle posée sur le nœud (notesInFlow: false). */
export interface RenameWithNote extends RenameSpec {
  note?: string;
  /** Make : l'id du module, seul à le désigner — deux modules sans nom portent le même libellé. */
  moduleId?: number;
}

export interface RenameSuggestion extends RenameWithNote {
  reason: string;
}

export interface SuggestNamesOptions {
  /** Langue des noms proposés (la note suit la langue d'affichage). */
  language?: 'en' | 'fr';
  /** 'default-names' : seuls les noms par défaut ; 'all' : tout le workflow (uniformisation). */
  scope?: 'default-names' | 'all';
}

@Injectable()
export class OptimizerService {
  private readonly logger = new Logger(OptimizerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly workflows: WorkflowsService,
    private readonly sync: WorkflowSyncService,
    private readonly ignores: FindingIgnoreService,
    private readonly profiles: CheckProfilesService,
    private readonly instances: InstancesService,
    private readonly envChain: EnvChainGuardService,
    private readonly makeNaming: MakeNamingService,
    @Inject(AI_PORT) private readonly ai: AiPort,
    @Inject(N8N_API_PORT) private readonly n8n: N8nApiPort,
    private readonly locks: WorkflowLockService,
    private readonly platformLocale: PlatformLocale,
  ) {}

  /**
   * Analyse : findings de naming/doublons + zones sticky, persistés.
   * `disabledChecks` : sélection de l'écran de lancement, prioritaire sur le profil.
   */
  analyze(workflowId: string, disabledChecks?: string[]): Promise<Finding[]> {
    // Les findings sont stockés pour tous : dans la langue de la plateforme, pas celle du lanceur.
    return this.platformLocale.run(() => this.runAnalysis(workflowId, disabledChecks));
  }

  private async runAnalysis(workflowId: string, disabledChecks?: string[]): Promise<Finding[]> {
    const { workflow, raw } = await this.workflows.getRawAny(workflowId);
    const off = new Set(await this.profiles.effective(workflowId, disabledChecks));
    // Les zones sticky n'existent pas chez Make : seul le naming s'y juge.
    const issues =
      workflow.platform === 'make'
        ? findMakeNamingIssues(raw)
        : [...findNamingIssues(raw as N8nWorkflow), ...findStickyIssues(raw as N8nWorkflow)];
    const found = issues.filter((finding) => !off.has(finding.code));
    // Les findings déclarés « normaux » ne sont jamais persistés
    const { kept: findings } = await this.ignores.filterIgnored(workflowId, 'optimizer', found);

    await this.prisma.finding.deleteMany({ where: { workflowId, module: 'optimizer' } });
    await this.prisma.finding.createMany({
      data: findings.map((f) => ({
        workflowId,
        module: 'optimizer',
        severity: f.severity,
        code: f.code,
        message: f.message,
        nodeName: f.nodeName,
        data: f.data as object | undefined,
      })),
    });
    const stored = await this.prisma.finding.findMany({ where: { workflowId, module: 'optimizer' } });
    await this.prisma.analysisRun.create({
      data: { workflowId, module: 'optimizer', findingsCount: stored.length },
    });
    return stored;
  }

  /** Suggestions de renommage par IA (basées sur les paramètres réels des nœuds). */
  async suggestNames(workflowId: string, options: SuggestNamesOptions = {}): Promise<RenameSuggestion[]> {
    const language = options.language ?? 'en';
    const scope = options.scope ?? 'default-names';
    if (!(await this.ai.isConfigured())) return [];
    const any = await this.workflows.getRawAny(workflowId);
    if (any.workflow.platform === 'make') return this.makeNaming.suggestNames(any.raw, { language, scope });
    const raw = any.raw as N8nWorkflow;

    let candidates = raw.nodes.filter((n) => !isStickyNote(n));
    if (scope === 'default-names') {
      const badlyNamed = findNamingIssues(raw)
        .filter((f) => f.code === 'default-name')
        .map((f) => f.nodeName);
      candidates = candidates.filter((n) => badlyNamed.includes(n.name));
    }
    if (candidates.length === 0) return [];

    // Seul le prompt est masqué : le renommage, lui, repart du workflow complet.
    const nodes = candidates.map((n) => ({
      name: n.name,
      type: n.type,
      parameters: redactSecrets(n.parameters),
    }));
    const mission =
      scope === 'all'
        ? 'You harmonise the naming of ALL the nodes of an n8n workflow: same language and same style ' +
          '(verb + object) for all. Return ONLY the nodes whose name must change.'
        : 'You rename badly named n8n nodes.';
    const naming =
      language === 'en'
        ? 'Propose a short name IN ENGLISH describing the action (e.g. "Fetch Airtable orders", "Filter active clients") ' +
          '— English is more compact on the canvas.'
        : 'Propose a short name IN FRENCH describing the action (e.g. "Récupérer commandes Airtable", "Filtrer clients actifs").';

    try {
      const suggestions = await this.ai.generateJson<RenameSuggestion[]>({
        system:
          `${mission} ${naming} ` +
          'New names must be unique in the workflow. ' +
          `Add in "note" a more verbose description (1-2 sentences) of what the node does, IN ${languageName().toUpperCase()}; ` +
          `write "reason" in ${languageName()} too. ` +
          'Answer in JSON: [{"oldName": "...", "newName": "...", "note": "...", "reason": "..."}]',
        prompt: JSON.stringify(nodes),
        maxTokens: 8192,
      });
      return suggestions.filter((s) => s.newName?.trim() && s.newName.trim() !== s.oldName);
    } catch (error) {
      this.logger.warn(`AI suggestions failed: ${(error as Error).message}`);
      return [];
    }
  }

  /** Applique des renommages en sécurité (connexions + expressions + pinData) puis PUT. */
  async applyRenames(workflowId: string, renames: RenameWithNote[]): Promise<{ renamed: number }> {
    if (renames.length === 0) return { renamed: 0 };
    const { workflow: meta } = await this.workflows.getRawAny(workflowId);
    if (meta.platform === 'make') return this.makeNaming.applyRenames(workflowId, renames);
    // Renommer un nœud réécrit le workflow : en mode bloquant, un env aval ne se
    // modifie qu'en y promouvant.
    await this.envChain.assertDirectWriteAllowed(workflowId);
    await this.locks.assertWritable(workflowId);
    const { workflow, raw } = await this.workflows.getRaw(workflowId);

    // Collision = connexions/expressions ambiguës : on refuse avant de toucher au workflow.
    const renamedOld = new Set(renames.map((r) => r.oldName));
    const finalNames = raw.nodes
      .filter((n) => !renamedOld.has(n.name))
      .map((n) => n.name)
      .concat(renames.map((r) => r.newName));
    const duplicates = finalNames.filter((name, i) => finalNames.indexOf(name) !== i);
    if (duplicates.length > 0) {
      throw new BadRequestException(
        msg('analysis.renameDuplicates', { names: [...new Set(duplicates)].join(', ') }),
      );
    }

    const updated = safeRenameNodes(raw, renames);

    const noteByNewName = new Map(
      renames.filter((r) => r.note?.trim()).map((r) => [r.newName, r.note!.trim()]),
    );
    updated.nodes = updated.nodes.map((node) => {
      const note = noteByNewName.get(node.name);
      return note ? { ...node, notes: note, notesInFlow: false } : node;
    });
    const config = await this.instances.getConfig(workflow.instanceId);
    await this.n8n.updateWorkflow(config, workflow.externalId, updated);

    // Resync du snapshot local (émet workflow.synced) : sans ça, les analyses
    // relisent l'ancien raw en DB.
    const fresh = await this.n8n.getWorkflow(config, workflow.externalId);
    await this.sync.upsertWorkflow(workflow.instanceId, fresh);

    this.eventBus.emit(EVENTS.optimizerApplied, { workflowId, renamed: renames.length });
    return { renamed: renames.length };
  }
}
