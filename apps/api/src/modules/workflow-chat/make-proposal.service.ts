import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { WorkflowChatProposal } from '@prisma/client';
import {
  GateVerdict,
  MakeApiError,
  MakeBlueprint,
  MakeEditOperation,
  WorkflowEditOperation,
  applyBlueprintEdits,
  detectWorkflowEnv,
  diffBlueprintsForReview,
  evaluateMakeProposalGate,
  hashContent,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EnvChainGuardService } from '../../infra/settings/env-chain-guard.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { WorkflowWithEnv, WorkflowsService } from '../workflows/workflows.service';
import { WorkflowSyncService } from '../workflows/workflow-sync.service';
import { InstancesService } from '../instances/instances.service';
import { RestorePointService } from './restore-point.service';
import type { ApplyResult, ProposalReview } from './proposal.service';
import { WorkflowLockService } from '../../infra/workflow-lock/workflow-lock.service';

/**
 * Les propositions de l'assistant sur un scénario Make : les bâtir, les juger,
 * les relire, les écrire.
 *
 * Même table et même écran que n8n — une proposition est une proposition —, mais
 * tout ce qui lit le contenu est celui de Make : les opérations
 * (`blueprint-edit.ts`), la porte (`make-proposal-gate.ts`), le diff
 * (`blueprint-review-diff.ts`). Pas de sous-workflow ici : l'assistant Make ne
 * touche qu'au scénario ouvert.
 */
@Injectable()
export class MakeProposalService {
  private readonly logger = new Logger(MakeProposalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowsService,
    private readonly sync: WorkflowSyncService,
    private readonly instances: InstancesService,
    private readonly restorePoints: RestorePointService,
    private readonly envChain: EnvChainGuardService,
    private readonly settings: PlatformSettingsService,
    private readonly locks: WorkflowLockService,
  ) {}

  /** Ce que donnerait ce brouillon, sans rien enregistrer : c'est ce que juge `check_scenario`. */
  async evaluate(
    workflowId: string,
    operations: MakeEditOperation[],
  ): Promise<{ gate: GateVerdict; warnings: string[]; candidate: MakeBlueprint; before: unknown }> {
    const { workflow, raw } = await this.workflows.getFreshRawAny(workflowId);
    const { blueprint: candidate, warnings } = applyBlueprintEdits(raw, operations);
    return { gate: await this.gateFor(workflow, raw, candidate), warnings, candidate, before: raw };
  }

  /** La proposition est enregistrée même bloquée : on veut pouvoir en lire le diff. */
  async create(
    workflowId: string,
    sessionId: string | null,
    summary: string,
    operations: MakeEditOperation[],
  ): Promise<{ proposal: WorkflowChatProposal; gate: GateVerdict }> {
    const { workflow, raw } = await this.workflows.getFreshRawAny(workflowId);
    const { blueprint: candidate } = applyBlueprintEdits(raw, operations);
    const proposal = await this.prisma.workflowChatProposal.create({
      data: {
        workflowId,
        sessionId,
        baseHash: workflow.hash,
        summary,
        operations: operations as unknown as object,
        raw: candidate as unknown as object,
      },
    });
    return { proposal, gate: await this.gateFor(workflow, raw, candidate) };
  }

  async review(proposal: WorkflowChatProposal): Promise<ProposalReview> {
    // Relu depuis Make : le drapeau `stale` ne vaut rien s'il compare la
    // proposition à une copie locale aussi vieille qu'elle.
    const { workflow, raw } = await this.workflows.getFreshRawAny(proposal.workflowId);
    const operations = proposal.operations as unknown as MakeEditOperation[];
    let warnings: string[] = [];
    try {
      warnings = applyBlueprintEdits(raw, operations).warnings;
    } catch (error) {
      warnings = [`Opérations non rejouables sur l'état actuel : ${(error as Error).message}`];
    }
    return {
      id: proposal.id,
      platform: 'make',
      workflowId: proposal.workflowId,
      sessionId: proposal.sessionId,
      summary: proposal.summary,
      operations: operations as unknown as WorkflowEditOperation[],
      status: proposal.status,
      createdAt: proposal.createdAt,
      appliedAt: proposal.appliedAt,
      warnings,
      stale: workflow.hash !== proposal.baseHash,
      workflowActive: workflow.active,
      // Make ne sépare pas brouillon et version publiée : l'écriture est ce qui tourne.
      writeEffect: null,
      restorePoint: await this.restorePoints.find(proposal.workflowId, workflow.hash),
      revertPoint:
        proposal.status === 'applied'
          ? await this.restorePoints.find(proposal.workflowId, proposal.baseHash)
          : null,
      revertLosesLaterChanges: proposal.status === 'applied' && workflow.hash !== hashContent(proposal.raw),
      workflowName: workflow.name,
      diff: diffBlueprintsForReview(raw, proposal.raw),
      gate: await this.gateFor(workflow, raw, proposal.raw),
      parts: [],
      leftovers: [],
    };
  }

  /**
   * Écrit le blueprint candidat dans Make, puis resynchronise (ce qui archive une
   * version). Même frontière que côté n8n : avant l'écriture un échec est un vrai
   * échec, après elle Make a DÉJÀ changé, et une relecture qui tombe ne doit pas
   * se présenter comme un refus d'appliquer.
   */
  async apply(proposal: WorkflowChatProposal, force: boolean): Promise<ApplyResult> {
    await this.envChain.assertDirectWriteAllowed(proposal.workflowId);
    await this.locks.assertWritable(proposal.workflowId);
    if (proposal.status !== 'pending') {
      throw new BadRequestException(
        `Proposition déjà ${proposal.status === 'applied' ? 'appliquée' : 'rejetée'}`,
      );
    }
    // Le blueprint est écrit EN ENTIER : tout ce que la copie locale ignore serait
    // écrasé sans être vu. D'où la relecture avant de comparer les empreintes.
    const { workflow, raw, missing } = await this.workflows.getFreshRawAny(proposal.workflowId);
    if (missing) {
      throw new BadRequestException('Make ne connaît plus ce scénario : rien ne peut y être écrit.');
    }
    if (workflow.hash !== proposal.baseHash) {
      throw new ConflictException(
        `« ${workflow.name} » a changé dans Make depuis que cette modification a été préparée. ` +
          "L'appliquer maintenant écraserait ce changement : relance la demande dans la conversation " +
          'pour repartir de cet état.',
      );
    }

    const gate = await this.gateFor(workflow, raw, proposal.raw, force);
    if (gate.blocked) {
      await this.noteInSession(
        proposal.sessionId,
        `**Application refusée** — ${proposal.summary}\n\n${gate.reason ?? ''}`,
      );
      throw new BadRequestException(gate.reason);
    }

    // Relevé AVANT l'écriture : après, l'état courant est le nouveau.
    const restorePoint = await this.restorePoints.find(proposal.workflowId, workflow.hash);
    const { port, config } = await this.instances.getPlatformConfig(workflow.instanceId);
    try {
      await port.updateWorkflow(config, workflow.externalId, proposal.raw);
    } catch (error) {
      throw this.writeRefused(error, workflow.name);
    }

    await this.prisma.workflowChatProposal.update({
      where: { id: proposal.id },
      data: { status: 'applied', appliedAt: new Date() },
    });
    this.logger.log(`Proposition ${proposal.id} appliquée au scénario « ${workflow.name} »`);

    const fallback = restorePoint
      ? `\n\nSi ça tourne mal, l'état d'avant est archivé (version du ${restorePoint.createdAt.toLocaleString('fr-FR')}) et se restaure depuis la revue ou la page Versions.`
      : "\n\nAucun point de retour archivé pour l'état d'avant : préviens-le avant de proposer autre chose.";
    try {
      const synced = await this.sync.syncWorkflow(proposal.workflowId);
      await this.noteInSession(
        proposal.sessionId,
        `**Modification appliquée dans Make** — ${proposal.summary}\n\n` +
          `« ${workflow.name} » est à jour côté Make` +
          (synced.changed ? ', et une nouvelle version a été enregistrée' : '') +
          '. Tout ce qui suit repart de cet état.' +
          fallback,
      );
      return { ok: true, versionCreated: synced.changed, restorePoint };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(`Proposition ${proposal.id} appliquée dans Make, mais resynchro KO : ${detail}`);
      await this.noteInSession(
        proposal.sessionId,
        `**Modification appliquée dans Make** — ${proposal.summary}\n\n` +
          `L'écriture a abouti, mais la plateforme n'a pas réussi à relire « ${workflow.name} » juste après : ` +
          'relis-le avant de proposer autre chose.' +
          fallback,
      );
      return {
        ok: true,
        versionCreated: false,
        restorePoint,
        syncError:
          "La modification est bien enregistrée dans Make, mais la plateforme n'a pas réussi à relire le " +
          "scénario juste après : aucune version n'a été archivée pour ce changement. La synchro horaire le rattrapera.",
      };
    }
  }

  private async gateFor(
    workflow: WorkflowWithEnv,
    before: unknown,
    after: unknown,
    force = false,
  ): Promise<GateVerdict> {
    return evaluateMakeProposalGate(before, after, {
      env: detectWorkflowEnv(workflow.name, workflow.tags, await this.settings.declaredEnvIds()),
      active: workflow.active,
      force,
    });
  }

  /** Un refus de Make se lit à l'écran : il dit ce qui manque, et que rien n'a bougé. */
  private writeRefused(error: unknown, workflowName: string): Error {
    if (!(error instanceof MakeApiError) || error.status >= 500) return error as Error;
    return new UnprocessableEntityException(
      `Make a refusé d'enregistrer « ${workflowName} » (erreur ${error.status}). Rien n'a été modifié. ` +
        `Ce qu'il répond : ${error.message}`,
    );
  }

  private async noteInSession(sessionId: string | null, content: string): Promise<void> {
    if (!sessionId) return;
    try {
      await this.prisma.workflowChatMessage.create({ data: { sessionId, role: 'assistant', content } });
    } catch (error) {
      this.logger.warn(`Note de proposition non écrite (session ${sessionId}) : ${(error as Error).message}`);
    }
  }
}
