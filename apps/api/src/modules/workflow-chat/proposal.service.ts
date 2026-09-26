import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { WorkflowChatProposal } from '@prisma/client';
import {
  CheckFinding,
  GateVerdict,
  N8N_API_PORT,
  N8nApiPort,
  N8nApiError,
  N8nWorkflow,
  WorkflowDiff,
  WorkflowEditOperation,
  applyEditOperations,
  WorkflowEditError,
  checkWorkflowIntegrity,
  describePublishRefusal,
  describeWriteEffect,
  detectPublishModel,
  writeIsLive,
  detectWorkflowEnv,
  diffWorkflows,
  evaluateProposalGate,
  hashWorkflow,
  msg,
  parsePublishRefusal,
  runWorkflowChecks,
} from '@nwm/core';
import { chatDate } from './chat-date';
import { isN8nAuthRefusal, n8nAuthRefused } from '../../common/filters/n8n-error.mapper';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EnvChainGuardService } from '../../infra/settings/env-chain-guard.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { WorkflowWithEnv, WorkflowsService } from '../workflows/workflows.service';
import { WorkflowSyncService } from '../workflows/workflow-sync.service';
import { InstancesService } from '../instances/instances.service';
import { InstanceCredentialsService, describeFills } from './instance-credentials.service';
import { InstanceShapesService } from './instance-shapes.service';
import { NodeCatalogService } from '../../infra/node-catalog/node-catalog.service';
import { RestorePoint, RestorePointService } from './restore-point.service';
import { ChatLeftover, ChatLeftoversService } from './chat-leftovers.service';
import { MakeProposalService } from './make-proposal.service';
import { WorkflowLockService } from '../../infra/workflow-lock/workflow-lock.service';

/**
 * Le verdict d'un workflow que la proposition ne touche pas : rien n'y est écrit,
 * donc rien n'y est jugé. Le calculer quand même ferait bloquer une découpe en
 * sous-workflow sur une faute que l'appelant portait déjà et que personne
 * n'introduit ici.
 */
const UNTOUCHED: GateVerdict = { blocked: false, breaches: [], introduced: [], refusals: [] };

/** Un workflow ANNEXE visé par une proposition : un sous-workflow appelé. */
export interface ProposalPartInput {
  workflowId: string;
  operations: WorkflowEditOperation[];
}

/**
 * Un workflow annexe, tel qu'on le relit avant d'appliquer. Mêmes questions que
 * pour la racine — a-t-il bougé, la porte laisse-t-elle passer, qu'est-ce qui
 * change — parce qu'un sous-workflow s'édite dans n8n comme n'importe quel autre
 * pendant qu'on prépare la modification.
 */
export interface ProposalPartReview {
  workflowId: string;
  workflowName: string;
  operations: WorkflowEditOperation[];
  status: string;
  appliedAt: Date | null;
  warnings: string[];
  stale: boolean;
  workflowActive: boolean;
  diff: WorkflowDiff;
  gate: GateVerdict;
}

/** Proposition + tout ce qu'il faut pour la revoir avant application. */
export interface ProposalReview {
  id: string;
  /** Où la modification sera écrite : l'écran nomme la plateforme, jamais « n8n » d'office. */
  platform: 'n8n' | 'make';
  workflowId: string;
  sessionId: string | null;
  summary: string;
  operations: WorkflowEditOperation[];
  status: string;
  createdAt: Date;
  appliedAt: Date | null;
  warnings: string[];
  /** Le workflow a changé depuis la proposition : appliquer écraserait ces changements. */
  stale: boolean;
  /** Le workflow est actif sur n8n (l'application part en production). */
  workflowActive: boolean;
  /**
   * Ce que l'écriture produira réellement quand ce n'est pas évident — un workflow
   * jamais publié ne reçoit qu'un brouillon. Dit AVANT le clic : le découvrir au
   * retour du bouton, c'est déjà avoir cru que la modification était en production.
   */
  writeEffect: string | null;
  /**
   * L'état actuel est archivé sous cette version : c'est là qu'on reviendra si
   * l'application tourne mal. Dit avant le clic — savoir qu'un filet existe fait
   * partie de la décision d'appliquer.
   */
  restorePoint: RestorePoint | null;
  /**
   * L'état d'AVANT cette application, une fois qu'elle a eu lieu : de quoi la
   * défaire des jours plus tard, depuis la revue.
   *
   * Ce n'est pas `restorePoint`, qui désigne l'état COURANT — le bon filet tant
   * qu'on n'a pas écrit, et le workflow abîmé une fois qu'on a écrit. Apparié sur
   * `baseHash`, la seule empreinte qui dise sur quoi la proposition a été bâtie.
   */
  revertPoint: RestorePoint | null;
  /**
   * Le workflow a bougé depuis l'application : revenir en arrière emporterait
   * aussi ce qui a été fait après. Dit avant le clic, jamais découvert après.
   */
  revertLosesLaterChanges: boolean;
  workflowName: string;
  diff: WorkflowDiff;
  /**
   * Ce que la modification casse, et si ça suffit à la refuser ici. Recalculé
   * comme les warnings : la porte doit juger l'état courant, pas celui d'hier.
   */
  gate: GateVerdict;
  /**
   * Les autres workflows du périmètre touchés par la même proposition. Vide dans
   * le cas ordinaire — une modification s'arrête le plus souvent au workflow
   * ouvert —, et c'est pourquoi la racine garde tout son appareil (point de
   * retour, retour arrière, publication) plutôt que de devenir une entrée parmi
   * d'autres dans une liste.
   */
  parts: ProposalPartReview[];
  /**
   * Sous-workflows créés par l'assistant pour cette conversation et que rien
   * n'est venu remplir. Recalculés sur l'état réel, et seulement une fois la
   * proposition tranchée : tant qu'elle est en attente, un sous-workflow vide
   * est un chantier en cours, pas un reste.
   */
  leftovers: ChatLeftover[];
}

/**
 * Ce que l'application a réellement fait. `syncError` dit que n8n a bien été écrit
 * mais que la plateforme n'a pas su relire derrière : un demi-succès qui doit se
 * lire comme tel, jamais comme un échec.
 */
export interface ApplyResult {
  ok: true;
  versionCreated: boolean;
  syncError?: string;
  /**
   * L'écriture n'a produit qu'un brouillon : l'instance publie par versions et ce
   * workflow ne l'a jamais été. Annoncer « appliqué » sans le dire donnerait pour
   * en production quelque chose qui ne s'exécutera jamais.
   */
  draftOnly?: boolean;
  /**
   * Où revenir si l'application a mal tourné, relevé AVANT l'écriture. `null`
   * quand il n'y en a pas : le dire vaut mieux que laisser croire à un filet.
   */
  restorePoint: RestorePoint | null;
  /** Ce que les workflows annexes sont devenus, dans l'ordre d'écriture. */
  parts?: Array<{ workflowName: string; versionCreated: boolean }>;
}

@Injectable()
export class ProposalService {
  private readonly logger = new Logger(ProposalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowsService,
    private readonly sync: WorkflowSyncService,
    private readonly instances: InstancesService,
    private readonly credentials: InstanceCredentialsService,
    private readonly shapes: InstanceShapesService,
    private readonly nodeCatalog: NodeCatalogService,
    private readonly restorePoints: RestorePointService,
    private readonly leftovers: ChatLeftoversService,
    private readonly envChain: EnvChainGuardService,
    @Inject(N8N_API_PORT) private readonly n8n: N8nApiPort,
    private readonly settings: PlatformSettingsService,
    private readonly make: MakeProposalService,
    private readonly locks: WorkflowLockService,
  ) {}

  /** Un scénario Make se relit et s'écrit par son propre service : rien de ce qui suit ne lit un blueprint. */
  private async isMake(workflowId: string): Promise<boolean> {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
      select: { instance: { select: { platform: true } } },
    });
    return workflow?.instance.platform === 'make';
  }

  /**
   * Ce que donnerait cette proposition, SANS rien enregistrer.
   *
   * Le même chemin que `create`, arrêté avant la persistance : c'est ce qui
   * permet à l'assistant de faire juger son brouillon par la porte elle-même,
   * dans son tour, et de le corriger avant qu'une proposition n'existe. Créer
   * pour juger laisserait dans le fil autant de propositions refusées que de
   * passes de correction, toutes à relire pour rien.
   */
  async evaluate(
    workflowId: string,
    operations: WorkflowEditOperation[],
  ): Promise<{ gate: GateVerdict; warnings: string[]; workflowName: string; candidate: N8nWorkflow }> {
    const { workflow, raw } = await this.workflows.getFreshRaw(workflowId);
    const { candidate, warnings } = await this.buildCandidate(workflow.instanceId, raw, operations);
    // Le candidat est rendu avec le verdict : un finding porte un NOM de nœud, et
    // c'est son TYPE qui indexe une leçon apprise d'un refus. Le résoudre ailleurs
    // demanderait de reconstruire le candidat une seconde fois — un nœud que la
    // proposition ajoute n'existe nulle part ailleurs.
    return {
      gate: await this.gateFor(workflow, raw, candidate),
      warnings,
      workflowName: workflow.name,
      candidate,
    };
  }

  /**
   * Le verdict de chaque workflow d'une proposition, racine comprise.
   *
   * Un seul chemin pour la correction dans le tour : un brouillon qui pose
   * l'appel d'un côté et le contenu de l'autre n'est acceptable que si les DEUX
   * passent — juger la seule racine laisserait partir à l'écran un sous-workflow
   * que rien n'écrira.
   */
  async evaluateAll(
    root: { workflowId: string; operations: WorkflowEditOperation[] },
    parts: ProposalPartInput[],
  ): Promise<Array<{ workflowId: string; workflowName: string; gate: GateVerdict; candidate: N8nWorkflow }>> {
    const verdicts: Array<{
      workflowId: string;
      workflowName: string;
      gate: GateVerdict;
      candidate: N8nWorkflow;
    }> = [];
    // Les opérations sur la racine peuvent être vides : une découpe en
    // sous-workflow qui ne touche d'abord que l'appelé est une proposition
    // valable, et lui inventer un diff vide n'apprendrait rien.
    const targets = [
      ...(root.operations.length > 0 ? [{ workflowId: root.workflowId, operations: root.operations }] : []),
      ...parts,
    ];
    for (const target of targets) {
      const { gate, workflowName, candidate } = await this.evaluate(target.workflowId, target.operations);
      verdicts.push({ workflowId: target.workflowId, workflowName, gate, candidate });
    }
    return verdicts;
  }

  /**
   * Transforme des opérations proposées par l'IA en proposition persistée.
   * Les opérations invalides ne créent rien : le message d'erreur repart dans la conversation.
   */
  async create(
    workflowId: string,
    sessionId: string | null,
    summary: string,
    operations: WorkflowEditOperation[],
    parts: ProposalPartInput[] = [],
  ): Promise<{ proposal: WorkflowChatProposal; gate: GateVerdict }> {
    if (operations.length === 0 && parts.length === 0) {
      throw new WorkflowEditError(msg('chat.proposalNoOperation'));
    }
    const { workflow, raw } = await this.workflows.getFreshRaw(workflowId);
    // La racine peut n'avoir AUCUNE opération : une découpe en sous-workflow
    // commence par remplir l'appelé, et le geste est complet sans toucher à
    // l'appelant. Rien ne sera écrit ici — ni candidat à bâtir, ni porte à
    // franchir, la porte de chaque annexe jugeant ce qui part réellement.
    const touchesRoot = operations.length > 0;
    const candidate = touchesRoot
      ? (await this.buildCandidate(workflow.instanceId, raw, operations)).candidate
      : raw;
    // La proposition est enregistrée même bloquée : on veut pouvoir en lire le
    // diff. C'est l'application qui est refusée, pas la conversation.
    const gate = touchesRoot ? await this.gateFor(workflow, raw, candidate) : UNTOUCHED;
    // Les annexes sont bâties AVANT la création : une opération inapplicable sur
    // un sous-workflow doit faire échouer la proposition entière, et non laisser
    // en base une racine orpheline dont le diff cacherait la moitié du geste.
    const built = await Promise.all(
      parts.map(async (part) => {
        const target = await this.workflows.getFreshRaw(part.workflowId);
        const { candidate: partCandidate } = await this.buildCandidate(
          target.workflow.instanceId,
          target.raw,
          part.operations,
        );
        return {
          workflowId: part.workflowId,
          baseHash: target.workflow.hash,
          operations: part.operations as unknown as object,
          raw: partCandidate as unknown as object,
        };
      }),
    );
    const proposal = await this.prisma.workflowChatProposal.create({
      data: {
        workflowId,
        sessionId,
        baseHash: workflow.hash,
        summary,
        operations: operations as unknown as object,
        raw: candidate as unknown as object,
        ...(built.length > 0 ? { parts: { create: built } } : {}),
      },
    });
    return { proposal, gate };
  }

  /**
   * Le candidat, et ce qu'on a décidé à la place de l'humain.
   *
   * Un seul chemin pour la création et pour la revue : la revue rejoue les
   * opérations sur l'état courant, et si elle le faisait autrement, le diff
   * qu'on relit ne serait pas celui qu'on écrit. C'est ici qu'on pose les
   * credentials des nœuds ajoutés — visible dans le diff comme le reste, parce
   * qu'un choix pris à notre initiative doit se relire avant d'être écrit.
   */
  private async buildCandidate(
    instanceId: string,
    raw: N8nWorkflow,
    operations: WorkflowEditOperation[],
  ): Promise<{ candidate: N8nWorkflow; warnings: string[] }> {
    const { workflow: edited, warnings } = applyEditOperations(raw, operations);
    const { workflow: candidate, filled } = await this.credentials.fillAddedNodes(instanceId, raw, edited);
    return { candidate, warnings: [...warnings, ...describeFills(filled)] };
  }

  /**
   * Confronte le candidat à l'état courant. `force` n'est pas un paramètre de
   * lecture : la revue montre toujours le verdict non contourné, la case est
   * cochée au moment d'appliquer.
   */
  private async gateFor(
    workflow: { name: string; tags: string[]; active: boolean; instanceId: string },
    raw: N8nWorkflow,
    candidate: N8nWorkflow,
    force = false,
  ): Promise<GateVerdict> {
    // Les mêmes contrôles que ceux dont dispose l'assistant avec `check_workflow` :
    // sans le SCHÉMA ici, la porte ignorait tout de ce que n8n déclare de ses
    // propres nœuds, et la seule `error` du lot — une sous-clé de collection non
    // déclarée, qui fait refuser l'écriture — ne lui parvenait jamais. Le contrôle
    // existait, l'assistant le voyait, et l'application partait quand même.
    //
    // Les écarts de forme, eux, rejoignent les findings des deux côtés : la porte
    // ne compte que ce que la modification INTRODUIT, et un paramètre déjà tordu
    // avant elle n'est pas son affaire — sauf ce que n8n refusera d'écrire,
    // qu'`evaluateProposalGate` relève sur le candidat entier.
    const [shapesBefore, shapesAfter, schemaBefore, schemaAfter] = await Promise.all([
      this.shapes.check(workflow.instanceId, raw),
      this.shapes.check(workflow.instanceId, candidate),
      this.nodeCatalog.check(raw, workflow.instanceId),
      this.nodeCatalog.check(candidate, workflow.instanceId),
    ]);
    return evaluateProposalGate(
      [...runWorkflowChecks(raw), ...shapesBefore, ...schemaBefore],
      [...runWorkflowChecks(candidate), ...shapesAfter, ...schemaAfter],
      {
        env: detectWorkflowEnv(workflow.name, workflow.tags, await this.settings.declaredEnvIds()),
        active: workflow.active,
        force,
        breaches: checkWorkflowIntegrity(raw, candidate),
      },
    );
  }

  async review(proposalId: string): Promise<ProposalReview> {
    const proposal = await this.prisma.workflowChatProposal.findUniqueOrThrow({
      where: { id: proposalId },
      include: { parts: { orderBy: { createdAt: 'asc' } } },
    });
    if (await this.isMake(proposal.workflowId)) return this.make.review(proposal);
    // Relu depuis n8n : c'est ici que se décide le drapeau `stale`, et il ne vaut
    // rien s'il compare la proposition à une copie locale aussi vieille qu'elle.
    const { workflow, raw } = await this.workflows.getFreshRaw(proposal.workflowId);
    const candidate = proposal.raw as unknown as N8nWorkflow;
    const operations = proposal.operations as unknown as WorkflowEditOperation[];

    // Une racine sans opération n'est pas relue : la proposition ne l'écrit pas.
    // Lui rejouer une liste vide ferait un « non rejouable » là où il n'y a rien
    // à rejouer, et un refus de porte sur un workflow auquel personne ne touche.
    const touchesRoot = operations.length > 0;
    // Les warnings sont recalculés : ils dépendent de l'état courant, pas de l'état d'origine.
    let warnings: string[] = [];
    if (touchesRoot) {
      try {
        warnings = (await this.buildCandidate(workflow.instanceId, raw, operations)).warnings;
      } catch (error) {
        warnings = [msg('chat.proposalReplayFailed', { detail: (error as Error).message })];
      }
    }

    return {
      id: proposal.id,
      platform: 'n8n',
      workflowId: proposal.workflowId,
      sessionId: proposal.sessionId,
      summary: proposal.summary,
      operations,
      status: proposal.status,
      createdAt: proposal.createdAt,
      appliedAt: proposal.appliedAt,
      warnings,
      stale: touchesRoot && workflow.hash !== proposal.baseHash,
      workflowActive: workflow.active,
      writeEffect: touchesRoot ? (describeWriteEffect(detectPublishModel(raw), workflow.name) ?? null) : null,
      // Ni filet ni retour arrière pour un workflow que la proposition n'écrit
      // pas : « revenir à l'état d'avant » y défairait le travail de quelqu'un
      // d'autre, jamais cette modification.
      restorePoint: touchesRoot ? await this.restorePoints.find(proposal.workflowId, workflow.hash) : null,
      revertPoint:
        touchesRoot && proposal.status === 'applied'
          ? await this.restorePoints.find(proposal.workflowId, proposal.baseHash)
          : null,
      revertLosesLaterChanges:
        touchesRoot && proposal.status === 'applied' && workflow.hash !== hashWorkflow(candidate),
      workflowName: workflow.name,
      diff: diffWorkflows(raw, candidate),
      gate: touchesRoot ? await this.gateFor(workflow, raw, candidate) : UNTOUCHED,
      parts: await Promise.all(proposal.parts.map((part) => this.reviewPart(part))),
      leftovers:
        proposal.status === 'pending' || !proposal.sessionId
          ? []
          : await this.leftovers.list({ sessionId: proposal.sessionId }),
    };
  }

  /**
   * Un workflow annexe, relu comme la racine. Il n'a ni point de retour ni
   * bouton de publication : ce qu'on veut d'un sous-workflow au moment de
   * relire, c'est ce qui change et ce qui bloque.
   */
  private async reviewPart(part: {
    workflowId: string;
    baseHash: string;
    operations: unknown;
    raw: unknown;
    status: string;
    appliedAt: Date | null;
  }): Promise<ProposalPartReview> {
    const { workflow, raw } = await this.workflows.getFreshRaw(part.workflowId);
    const candidate = part.raw as unknown as N8nWorkflow;
    const operations = part.operations as unknown as WorkflowEditOperation[];
    let warnings: string[] = [];
    try {
      warnings = (await this.buildCandidate(workflow.instanceId, raw, operations)).warnings;
    } catch (error) {
      warnings = [msg('chat.proposalReplayFailed', { detail: (error as Error).message })];
    }
    return {
      workflowId: part.workflowId,
      workflowName: workflow.name,
      operations,
      status: part.status,
      appliedAt: part.appliedAt,
      warnings,
      stale: workflow.hash !== part.baseHash,
      workflowActive: workflow.active,
      diff: diffWorkflows(raw, candidate),
      gate: await this.gateFor(workflow, raw, candidate),
    };
  }

  /**
   * Écrit le workflow candidat dans n8n puis resynchronise (ce qui crée une nouvelle version).
   *
   * Deux temps, et la frontière est le PUT. Avant lui, un échec est un vrai échec :
   * rien n'a bougé, on le dit. Après lui, n8n a DÉJÀ changé — une relecture ou une
   * resynchro qui tombe ne doit plus se présenter comme un refus d'appliquer. C'est
   * ce qui donnait une 500 qui semblait dire « rien n'a été fait », puis un 409 au
   * geste suivant : l'écriture, elle, avait bien eu lieu, et la proposition restait
   * `pending` avec une empreinte périmée.
   */
  async apply(proposalId: string, force = false): Promise<ApplyResult> {
    const proposal = await this.prisma.workflowChatProposal.findUniqueOrThrow({
      where: { id: proposalId },
      include: { parts: { orderBy: { createdAt: 'asc' } } },
    });
    if (await this.isMake(proposal.workflowId)) return this.make.apply(proposal, force);
    const pendingParts = proposal.parts.filter((part) => part.status === 'pending');
    const rootOperations = proposal.operations as unknown as WorkflowEditOperation[];
    // Une proposition qui ne remplit qu'un sous-workflow ne touche PAS l'appelant :
    // ni écriture, ni porte, ni empreinte à confronter. Le lui appliquer quand
    // même refuserait le geste dès que quelqu'un a édité l'appelant entre-temps,
    // pour une écriture qui n'aurait rien changé.
    const touchesRoot = rootOperations.length > 0;
    // Chaîne d'envs en mode bloquant : un env aval ne se modifie qu'en y promouvant.
    // Contrôlé AVANT tout le reste — relire n8n pour finir sur un refus de principe
    // ne sert qu'à faire attendre. Chaque workflow touché est contrôlé : une
    // proposition qui passe par un sous-workflow ne doit pas être une porte dérobée.
    if (touchesRoot) await this.envChain.assertDirectWriteAllowed(proposal.workflowId);
    for (const part of pendingParts) {
      await this.envChain.assertDirectWriteAllowed(part.workflowId);
    }
    await this.locks.assertWritable([
      ...(touchesRoot ? [proposal.workflowId] : []),
      ...pendingParts.map((part) => part.workflowId),
    ]);
    if (proposal.status !== 'pending') {
      throw new BadRequestException(msg('chat.proposalAlreadyDone', { status: proposal.status }));
    }
    // On écrit un workflow ENTIER : tout ce que la copie locale ignore de l'état
    // réel serait écrasé sans être vu. D'où la relecture depuis n8n avant même de
    // comparer les empreintes — sans elle, le garde-fou ci-dessous confrontait la
    // proposition à la copie d'hier et laissait passer.
    const { workflow, raw, missing } = await this.workflows.getFreshRaw(proposal.workflowId);
    if (touchesRoot && missing) {
      throw new BadRequestException(msg('chat.proposalWorkflowMissing'));
    }
    if (touchesRoot && workflow.hash !== proposal.baseHash) {
      throw new ConflictException(msg('chat.proposalStale', { name: workflow.name }));
    }
    if (touchesRoot && workflow.archived) {
      throw new BadRequestException(msg('chat.proposalArchived'));
    }

    const candidate = proposal.raw as unknown as N8nWorkflow;
    const gate = touchesRoot ? await this.gateFor(workflow, raw, candidate, force) : UNTOUCHED;
    if (gate.blocked) {
      // Consigné dans le fil, et pas seulement rendu au navigateur : le refus
      // décide de ce qu'il faut demander ensuite, et l'assistant ne le voyait
      // pas passer — il reproposait la même chose au tour suivant.
      await this.noteInSession(
        proposal.sessionId,
        msg('chat.proposalNoteRefused', { summary: proposal.summary, reason: gate.reason ?? '' }),
      );
      throw new BadRequestException(gate.reason);
    }

    // Les workflows annexes sont contrôlés ENTIÈREMENT avant que quoi que ce soit
    // ne parte : écrire l'appelé puis buter sur la porte de l'appelant laisserait
    // le parc dans un état que personne n'a validé, la moitié d'un geste indivisible.
    const partWrites = await this.preflightParts(pendingParts, force);
    // Écrits AVANT la racine : l'appelant pose souvent l'appel vers un contenu
    // qui doit déjà exister. Si l'un échoue, la racine n'est pas touchée — c'est
    // le sens qui se rattrape (un sous-workflow prêt que rien n'appelle encore).
    const partsApplied = await this.writeParts(partWrites);

    // Rien à écrire sur l'appelant : le geste s'arrête aux sous-workflows. Lui
    // renvoyer son propre contenu ferait une écriture et une version de plus pour
    // un JSON qui n'a pas bougé, et un point de retour promis sur un workflow
    // que personne n'a touché.
    if (!touchesRoot) {
      await this.prisma.workflowChatProposal.update({
        where: { id: proposalId },
        data: { status: 'applied', appliedAt: new Date() },
      });
      this.logger.log(`Proposal ${proposalId} applied (sub-workflows only)`);
      await this.noteInSession(
        proposal.sessionId,
        msg('chat.proposalNoteAppliedPartsOnly', {
          summary: proposal.summary,
          parts: describeParts(partsApplied),
          name: workflow.name,
        }),
      );
      return {
        ok: true,
        versionCreated: false,
        restorePoint: null,
        ...(partsApplied.length > 0 ? { parts: partsApplied } : {}),
      };
    }

    // Relevé AVANT l'écriture : après, l'état courant est le nouveau, et le point
    // de retour ne se retrouve plus qu'à la main dans la page Versions.
    const restorePoint = await this.restorePoints.find(proposal.workflowId, workflow.hash);

    // Sur une instance à versions, un workflow DÉJÀ publié est republié par le PUT
    // lui-même (`publishIfActive` vaut true par défaut) : rien à faire de plus. Un
    // workflow jamais publié, lui, ne reçoit qu'un brouillon — et le publier de
    // notre propre chef le mettrait en production sans que personne l'ait demandé.
    const draftOnly = !writeIsLive(detectPublishModel(raw));

    const config = await this.instances.getConfig(workflow.instanceId);
    try {
      await this.n8n.updateWorkflow(config, workflow.externalId, candidate);
    } catch (error) {
      throw this.writeRefused(error, workflow.name, gate.refusals);
    }

    // Passé ce point l'écriture EST faite. La proposition est close immédiatement :
    // la laisser `pending` invitait à rejouer un geste déjà abouti, et le seul
    // retour était alors le 409 ci-dessus, qui n'expliquait pas d'où il venait.
    await this.prisma.workflowChatProposal.update({
      where: { id: proposalId },
      data: { status: 'applied', appliedAt: new Date() },
    });
    this.logger.log(`Proposal ${proposalId} applied to "${workflow.name}"`);

    // Resynchronise le snapshot local : l'événement workflow.synced déclenche la nouvelle version.
    try {
      const fresh = await this.n8n.getWorkflow(config, workflow.externalId);
      const synced = await this.sync.upsertWorkflow(workflow.instanceId, fresh);
      await this.noteInSession(
        proposal.sessionId,
        msg('chat.proposalNoteApplied', {
          summary: proposal.summary,
          parts: describeParts(partsApplied),
          name: workflow.name,
          versioned: synced.hashChanged,
          draft: draftOnly,
          hasRestore: Boolean(restorePoint),
          restoredAt: restorePoint ? chatDate(restorePoint.createdAt) : '',
        }),
      );
      return {
        ok: true,
        versionCreated: synced.hashChanged,
        draftOnly,
        restorePoint,
        ...(partsApplied.length > 0 ? { parts: partsApplied } : {}),
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Proposal ${proposalId} applied in n8n, but resync failed: ${detail}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.noteInSession(
        proposal.sessionId,
        msg('chat.proposalNoteAppliedSyncFailed', { summary: proposal.summary, name: workflow.name }),
      );
      return {
        ok: true,
        versionCreated: false,
        draftOnly,
        restorePoint,
        ...(partsApplied.length > 0 ? { parts: partsApplied } : {}),
        syncError: msg('chat.proposalSyncError'),
      };
    }
  }

  /**
   * Relit chaque workflow annexe et le confronte à la porte, SANS rien écrire.
   *
   * Les mêmes refus que la racine, et pour les mêmes raisons : un sous-workflow
   * s'édite dans n8n pendant qu'on prépare la modification, et il s'archive
   * aussi. La seule différence est le message — il doit nommer le workflow, sans
   * quoi un refus de proposition renvoie l'humain vers celui qu'il a sous les
   * yeux, qui n'y est pour rien.
   */
  private async preflightParts(
    parts: Array<{ id: string; workflowId: string; baseHash: string; raw: unknown }>,
    force: boolean,
  ): Promise<
    Array<{ partId: string; workflow: WorkflowWithEnv; candidate: N8nWorkflow; refusals: CheckFinding[] }>
  > {
    const writes: Array<{
      partId: string;
      workflow: WorkflowWithEnv;
      candidate: N8nWorkflow;
      refusals: CheckFinding[];
    }> = [];
    for (const part of parts) {
      const { workflow, raw, missing } = await this.workflows.getFreshRaw(part.workflowId);
      if (missing) {
        throw new BadRequestException(msg('chat.proposalPartMissing', { name: workflow.name }));
      }
      if (workflow.archived) {
        throw new BadRequestException(msg('chat.proposalPartArchived', { name: workflow.name }));
      }
      if (workflow.hash !== part.baseHash) {
        throw new ConflictException(msg('chat.proposalPartStale', { name: workflow.name }));
      }
      const candidate = part.raw as unknown as N8nWorkflow;
      const gate = await this.gateFor(workflow, raw, candidate, force);
      if (gate.blocked) {
        throw new BadRequestException(
          msg('chat.proposalPartBlocked', {
            name: workflow.name,
            reason: gate.reason ?? msg('chat.proposalRefusedDefault'),
          }),
        );
      }
      writes.push({ partId: part.id, workflow, candidate, refusals: gate.refusals });
    }
    return writes;
  }

  /**
   * Écrit les workflows annexes, un par un, et les resynchronise.
   *
   * Chacun est clos dès son PUT réussi : un échec sur le suivant ne doit pas
   * faire rejouer celui qui est déjà passé. La resynchro, elle, ne fait pas
   * échouer l'application — n8n a déjà changé, et le cron horaire rattrapera un
   * miroir en retard.
   */
  private async writeParts(
    writes: Array<{
      partId: string;
      workflow: WorkflowWithEnv;
      candidate: N8nWorkflow;
      refusals: CheckFinding[];
    }>,
  ): Promise<Array<{ workflowName: string; versionCreated: boolean }>> {
    const applied: Array<{ workflowName: string; versionCreated: boolean }> = [];
    for (const write of writes) {
      const config = await this.instances.getConfig(write.workflow.instanceId);
      try {
        await this.n8n.updateWorkflow(config, write.workflow.externalId, write.candidate);
      } catch (error) {
        throw this.writeRefused(error, write.workflow.name, write.refusals);
      }
      await this.prisma.workflowChatProposalPart.update({
        where: { id: write.partId },
        data: { status: 'applied', appliedAt: new Date() },
      });
      this.logger.log(`Sub-workflow "${write.workflow.name}" written (part ${write.partId})`);
      let versionCreated = false;
      try {
        const fresh = await this.n8n.getWorkflow(config, write.workflow.externalId);
        versionCreated = (await this.sync.upsertWorkflow(write.workflow.instanceId, fresh)).hashChanged;
      } catch (error) {
        this.logger.warn(
          `"${write.workflow.name}" written in n8n, but resync failed: ${(error as Error).message}`,
        );
      }
      applied.push({ workflowName: write.workflow.name, versionCreated });
    }
    return applied;
  }

  /**
   * Refus de l'écriture rendu en français, avec le seul détail qui décide de la
   * suite : est-ce que n8n a pu changer ou non. Un `Internal server error` ne
   * disait ni ce que n8n reprochait, ni s'il fallait aller vérifier là-bas.
   */
  private writeRefused(error: unknown, workflowName: string, refusals: CheckFinding[] = []): Error {
    if (!(error instanceof N8nApiError)) return error as Error;
    if (isN8nAuthRefusal(error)) return n8nAuthRefused(error);

    const refusal = parsePublishRefusal(error.message);
    if (refusal) return new UnprocessableEntityException(describePublishRefusal(refusal));

    // Le message porte l'URL et le corps brut : utile dans les logs, illisible à l'écran.
    const detail = error.message
      .replace(/^n8n API [A-Z]+ \S+ → \d+:\s*/, '')
      .slice(0, 400)
      .trim();
    if (error.status >= 400 && error.status < 500) {
      return new UnprocessableEntityException(
        msg('chat.proposalWriteRejected', {
          name: workflowName,
          status: String(error.status),
          detail: detail || msg('chat.proposalNoDetail'),
        }) + this.whereItRefuses(error.message, refusals),
      );
    }
    return new BadGatewayException(
      msg('chat.proposalWriteFailed', {
        name: workflowName,
        status: String(error.status),
        detail: detail || msg('chat.proposalNoDetail'),
      }),
    );
  }

  /**
   * Ce que n8n ne dit pas de son propre refus.
   *
   * « Could not find property option » ne nomme ni le nœud, ni la clé, ni même le
   * paramètre : le message vient de la reconstruction du workflow entier, et il
   * s'arrête à la première faute. On y raccroche ce que la porte avait relevé —
   * c'est le seul endroit où le nom du nœud existe. Rien de relevé et le refus
   * porte quand même ce nom-là, c'est que le schéma nous manque : on le dit,
   * plutôt que de laisser croire à un contrôle qui aurait dû voir.
   */
  private whereItRefuses(message: string, refusals: CheckFinding[]): string {
    if (!message.includes('Could not find property option')) return '';
    if (refusals.length > 0) {
      return `\n\n${msg('chat.proposalWhereRefusals', {
        list: refusals
          .map((finding) =>
            msg('chat.proposalWhereItem', {
              hasNode: Boolean(finding.nodeName),
              node: finding.nodeName ?? '',
              message: finding.message,
            }),
          )
          .join(' '),
      })}`;
    }
    return `\n\n${msg('chat.proposalWhereUnknown')}`;
  }

  /**
   * Consigne dans la conversation ce qu'est devenue la proposition.
   *
   * Sans ça l'assistant ne savait jamais si sa modification était partie : il
   * reproposait la même chose, ou parlait du workflow comme s'il n'avait pas
   * bougé. Le tour suivant relit bien n8n, mais rien ne lui disait que c'était
   * LUI la cause du changement — la nuance décide de ce qu'il répond ensuite.
   *
   * Écrit en `assistant`, comme le message d'accueil d'un workflow vide : c'est
   * la plateforme qui parle dans le fil, et ça doit se lire dans le tiroir autant
   * que dans l'historique renvoyé au modèle. Un échec d'écriture de cette note ne
   * remonte pas : la modification, elle, est faite.
   */
  private async noteInSession(sessionId: string | null, content: string): Promise<void> {
    if (!sessionId) return;
    try {
      await this.prisma.workflowChatMessage.create({ data: { sessionId, role: 'assistant', content } });
    } catch (error) {
      this.logger.warn(`Proposal note not written (session ${sessionId}): ${(error as Error).message}`);
    }
  }

  async discard(proposalId: string): Promise<WorkflowChatProposal> {
    const proposal = await this.prisma.workflowChatProposal.findUniqueOrThrow({ where: { id: proposalId } });
    if (proposal.status !== 'pending') {
      throw new BadRequestException(msg('chat.proposalNotPending'));
    }
    const updated = await this.prisma.workflowChatProposal.update({
      where: { id: proposalId },
      data: { status: 'discarded' },
    });
    // Les annexes suivent le sort de la racine : une moitié restée « en attente »
    // n'aurait plus rien pour la porter, et se lirait comme un geste à finir.
    await this.prisma.workflowChatProposalPart.updateMany({
      where: { proposalId, status: 'pending' },
      data: { status: 'discarded' },
    });
    // « Rien n'a été écrit » cesse d'être vrai dès qu'un sous-workflow a été créé
    // pour cette conversation : le dire quand même laisserait l'assistant croire
    // qu'il doit le recréer au tour suivant, et l'humain ignorer ce qui traîne.
    const orphans = proposal.sessionId ? await this.leftovers.list({ sessionId: proposal.sessionId }) : [];
    await this.noteInSession(
      proposal.sessionId,
      msg('chat.proposalNoteDiscarded', { summary: proposal.summary }) +
        (orphans.length > 0
          ? `\n\n${msg('chat.proposalNoteDiscardedOrphans', {
              names: orphans.map((entry) => msg('chat.quotedName', { name: entry.name })).join(', '),
            })}`
          : ''),
    );
    return updated;
  }
}

/**
 * Les sous-workflows écrits, dits AVANT le sort du workflow ouvert : c'est la
 * partie du geste qu'on ne voit pas à l'écran, et la taire ferait croire qu'une
 * modification annoncée comme appliquée s'est arrêtée au workflow de la page.
 */
function describeParts(parts: Array<{ workflowName: string; versionCreated: boolean }>): string {
  if (parts.length === 0) return '';
  return `${msg('chat.proposalPartsWritten', {
    list: parts
      .map((part) =>
        msg('chat.proposalPartWritten', { name: part.workflowName, unchanged: !part.versionCreated }),
      )
      .join(', '),
  })}\n\n`;
}
