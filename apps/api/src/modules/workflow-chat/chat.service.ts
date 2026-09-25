import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AI_PORT,
  DOCS_PORT,
  DocsPort,
  AiAgentEvent,
  AiEffort,
  AiMessage,
  AiPort,
  AiThinkingStep,
  AiToolLoopError,
  AiToolTrace,
  ChatFileError,
  ChatFileInput,
  ChatImage,
  ChatImageError,
  ChatImageInput,
  ChatImageMediaType,
  ChatTextFile,
  AssistantProposalTarget,
  N8nWorkflow,
  ProposalState,
  ProposalSummary,
  UnansweredRequest,
  WorkflowEditError,
  WorkflowEditOperation,
  findNodeExamples,
  findScopeMember,
  isBlankWorkflow,
  parseAssistantTurn,
  limitHistoryFiles,
  limitHistoryImages,
  parseChatFiles,
  parseChatImages,
  renderChatFiles,
  pastedWorkflowBrief,
  findPastedWorkflows,
  proposalState,
  repairNote,
  toolProgressStep,
  writeRefusingFindings,
  summarizeEditOperations,
  summarizeProposalStates,
  unansweredRequest,
  workflowSkeleton,
} from '@nwm/core';
import { WorkflowChatAttachment, WorkflowChatMessage, WorkflowChatSession } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { WorkflowWithEnv, WorkflowsService } from '../workflows/workflows.service';
import { WorkflowCreateService } from '../workflows/workflow-create.service';
import { ProposalPartInput, ProposalService } from './proposal.service';
import { chatSystemPrompt } from './chat-prompt';
import { buildChatContext } from './workflow-context.builder';
import { ChatScopeEntry, CheckedDraft, buildChatTools } from './chat-tools';
import { ChatScopeService } from './chat-scope.service';
import { ChatLeftoversService } from './chat-leftovers.service';
import { InstanceCredentialsService } from './instance-credentials.service';
import { ChatMemoryService } from './chat-memory.service';
import { LessonRecallService } from './lesson-recall.service';
import { ChatHistoryService } from './chat-history.service';
import { InstanceShapesService } from './instance-shapes.service';
import { ExampleCorpusService } from './example-corpus.service';
import { NodeCatalogService } from '../../infra/node-catalog/node-catalog.service';
import { ChatProgressService } from './chat-progress.service';
import { ChatCancelService } from './chat-cancel.service';
import { DraftRepairService, ResolvedTargets } from './draft-repair.service';
import { MakeChatTurnService } from './make-chat-turn.service';

/** Nombre de tours renvoyés au modèle (au-delà, la conversation coûte cher pour rien). */
const HISTORY_LIMIT = 24;
const TITLE_MAX = 60;

/**
 * Profondeur de raisonnement du chat. Laissée au défaut, l'API réfléchit en `high`
 * et un simple correctif de finding se paie en dizaines de secondes d'attente, sur
 * une demande dont le contexte est pourtant déjà mâché (nœud visé, message, piste).
 */
const CHAT_EFFORT: AiEffort = 'medium';

/**
 * Allers-retours d'outils par tour. Le cycle utile en demande cinq depuis que
 * l'assistant peut relire n8n et consulter les credentials : relire, lire un
 * nœud, chercher sa credential, vérifier, corriger. Serré à quatre, la dernière
 * vérification sautait — celle qui décide s'il propose ou s'il recommence.
 * Une passe de plus depuis que le parc sert d'exemples : chercher comment le nœud
 * est monté ailleurs s'intercale AVANT la vérification, et c'est elle qui sautait.
 * La marge est large parce qu'une demande de CONSTRUCTION n'a pas le même appétit
 * qu'une correction : cinq nœuds à écrire, c'est autant de types à décrire et
 * d'exemples à relire avant la première vérification, et le budget épuisé faisait
 * perdre le tour ENTIER — des dizaines de secondes payées pour un message d'échec.
 * Deux passes de plus depuis la doc des systèmes tiers : chercher la fiche puis
 * lire le sujet s'intercalent AVANT la vérification, et c'est encore elle qui
 * sautait — le tour se terminait sur une doc lue pour rien, sans proposition.
 * Au-delà, le modèle tourne en rond, et chaque passe se paie en attente.
 */
const MAX_TOOL_ROUNDS = 14;

/**
 * Premier message d'une conversation ouverte sur un workflow encore vide.
 * Écrit ici et non demandé au modèle : la question est toujours la même, et un
 * appel IA pour la poser retarderait l'ouverture du tiroir de plusieurs secondes.
 */
const BLANK_WORKFLOW_GREETING = [
  'Ce workflow est vide : il ne contient que son déclencheur. **Que doit-il faire ?**',
  '',
  'Le plus utile à me dire :',
  '- ce qui le déclenche (appel webhook, planification, action manuelle) ;',
  '- les données qui entrent et d’où elles viennent ;',
  '- ce qui doit sortir à la fin, et où.',
  '',
  'Je proposerai les nœuds et leurs connexions ; rien ne part dans n8n avant que tu aies revu le diff.',
].join('\n');

/**
 * Texte porté par un message qui n'a qu'une capture. Écrit ici plutôt que laissé
 * vide : le modèle a besoin d'une demande, et l'historique d'une ligne lisible.
 */
const DEFAULT_IMAGE_PROMPT = 'Voici une capture d’écran. Que montre-t-elle, et que faut-il en faire ?';

/** Même chose pour un envoi qui n'a que des fichiers : la demande manque, on l'écrit. */
const DEFAULT_FILE_PROMPT = 'Voici un ou plusieurs fichiers joints. Que contiennent-ils, et qu’en faire ?';

/**
 * Ce qu'on écrit quand le modèle rend un tour SANS texte. Jamais la chaîne vide :
 * un message d'assistant vide repart dans l'historique au tour suivant, et les
 * deux fournisseurs le refusent (Mistral en 400 « Assistant message must have
 * either content or tool_calls »). La conversation devient alors définitivement
 * inutilisable — chaque relance rejoue le même message et échoue avant l'appel.
 */
const EMPTY_REPLY_NOTE =
  '⚠️ L’IA a terminé son tour sans rien répondre. Reformule ta demande, ou découpe-la en plusieurs étapes.';

export interface SendMessageOptions {
  /** Nœuds au cœur de la demande : leurs paramètres survivent à l'élagage du contexte. */
  focusNodes?: string[];
  /** Captures d'écran jointes à la question (n8n en erreur, panneau d'exécution). */
  images?: ChatImageInput[];
  /** Fichiers texte joints (JSON exporté, CSV, log d'exécution). */
  files?: ChatFileInput[];
}

/** Pièce jointe telle qu'affichée : les octets restent derrière leur URL, jamais dans le JSON. */
export interface ChatAttachmentRef {
  id: string;
  mediaType: string;
  /** Nom du fichier joint ; `null` pour une capture, qu'on affiche en vignette. */
  name: string | null;
  size: number;
}

export type ChatMessageWithAttachments = WorkflowChatMessage & { attachments: ChatAttachmentRef[] };

/**
 * Ce qu'un message porte en pièces jointes pendant un tour. Les deux formes ne
 * voyagent JAMAIS séparément : elles sont validées, enregistrées, rejouées et —
 * quand le tour est arrêté — rendues à la saisie d'un seul tenant.
 */
export interface TurnAttachments {
  images: ChatImage[];
  files: ChatTextFile[];
}

/** Ce qu'est devenue une modification proposée, pour l'afficher dans le fil. */
export interface ProposalRef {
  id: string;
  summary: string;
  state: ProposalState;
  appliedAt: Date | null;
}

/** Une conversation dans le sélecteur : son titre, et ce que ses propositions sont devenues. */
export type SessionSummary = WorkflowChatSession & {
  /** `null` quand la conversation n'a rien proposé (une simple question). */
  proposalSummary: ProposalSummary | null;
};

export type SessionWithMessages = WorkflowChatSession & {
  messages: ChatMessageWithAttachments[];
  /** Demande restée sans réponse, à relancer. Absente tant que le tour peut être en cours. */
  unanswered?: UnansweredRequest | null;
  /** Propositions de la conversation et leur état, à lire par `message.proposalId`. */
  proposals: ProposalRef[];
};

export interface SendMessageResult {
  userMessage: WorkflowChatMessage;
  /** `null` quand le tour a été interrompu : rien n'a été écrit, ni réponse ni demande. */
  assistantMessage: WorkflowChatMessage | null;
  proposalId: string | null;
  /**
   * Le tour a été arrêté à la demande de l'utilisateur. La demande est alors
   * DÉFAITE — message supprimé, captures comprises —, et rendue ici pour que la
   * saisie la retrouve entière : arrêter sert justement à reformuler, et une
   * demande qu'il faut retaper de mémoire ne s'arrête pas, elle s'endure.
   */
  cancelled?: { content: string; images: ChatImage[]; files: ChatTextFile[] };
}

/** Octets d'une pièce jointe, pour la servir au navigateur. */
export interface ChatAttachmentFile {
  mediaType: string;
  name: string | null;
  data: Buffer;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowsService,
    private readonly proposals: ProposalService,
    private readonly credentials: InstanceCredentialsService,
    private readonly memory: ChatMemoryService,
    private readonly lessons: LessonRecallService,
    private readonly history: ChatHistoryService,
    private readonly shapes: InstanceShapesService,
    private readonly nodeCatalog: NodeCatalogService,
    private readonly progress: ChatProgressService,
    private readonly cancels: ChatCancelService,
    private readonly repair: DraftRepairService,
    private readonly examples: ExampleCorpusService,
    private readonly scope: ChatScopeService,
    private readonly workflowCreate: WorkflowCreateService,
    private readonly leftovers: ChatLeftoversService,
    private readonly makeTurn: MakeChatTurnService,
    @Inject(AI_PORT) private readonly ai: AiPort,
    @Inject(DOCS_PORT) private readonly docs: DocsPort,
  ) {}

  /**
   * Les conversations du workflow, chacune résumée par l'état de ses propositions :
   * un fil laissé avec une modification à revoir ne doit pas se confondre, dans une
   * liste déroulante, avec celui dont tout est déjà appliqué.
   */
  async listSessions(workflowId: string): Promise<SessionSummary[]> {
    const [sessions, workflow] = await Promise.all([
      this.prisma.workflowChatSession.findMany({
        where: { workflowId },
        orderBy: { updatedAt: 'desc' },
        include: { proposals: { select: { status: true, baseHash: true } } },
      }),
      this.prisma.workflow.findUnique({ where: { id: workflowId }, select: { hash: true } }),
    ]);
    return sessions.map(({ proposals, ...session }) => ({
      ...session,
      proposalSummary: summarizeProposalStates(
        proposals.map((proposal) => proposalState(proposal, workflow?.hash ?? '')),
      ),
    }));
  }

  async createSession(workflowId: string): Promise<WorkflowChatSession> {
    const { workflow, raw } = await this.workflows.getRawAny(workflowId); // 404 si le workflow n'existe pas
    const session = await this.prisma.workflowChatSession.create({
      data: { workflowId, title: 'Nouvelle conversation' },
    });
    // Sur un workflow neuf, la conversation s'ouvre sur la question qui manque —
    // sinon l'assistant attend une demande sur un contenu qui n'existe pas encore.
    // Un scénario Make ne se construit pas ici : l'assistant n'y ajoute pas de module.
    if (workflow.platform === 'n8n' && isBlankWorkflow(raw as N8nWorkflow)) {
      await this.prisma.workflowChatMessage.create({
        data: { sessionId: session.id, role: 'assistant', content: BLANK_WORKFLOW_GREETING },
      });
      return this.prisma.workflowChatSession.update({
        where: { id: session.id },
        data: { title: 'Construction du workflow' },
      });
    }
    return session;
  }

  async getSession(sessionId: string): Promise<SessionWithMessages> {
    const session = await this.prisma.workflowChatSession.findUnique({
      where: { id: sessionId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          // `data` est exclu : une conversation de dix captures ferait plusieurs
          // dizaines de Mo de JSON à chaque ouverture du tiroir. Le navigateur
          // va chercher les octets image par image, et les met en cache.
          include: { attachments: { select: { id: true, mediaType: true, name: true, size: true } } },
        },
      },
    });
    if (!session) throw new NotFoundException(`Conversation ${sessionId} introuvable`);
    // L'état est calculé ici et non déduit côté web : le délai de grâce est une
    // règle, et une règle recopiée dans le navigateur dérive du serveur.
    return {
      ...session,
      unanswered: unansweredRequest(session.messages),
      proposals: await this.proposalRefs(sessionId, session.workflowId),
    };
  }

  /**
   * L'état de chaque proposition du fil. Comparé à l'empreinte du MIROIR : c'est
   * un badge, pas une autorisation d'écrire — la revue, elle, redemande le
   * workflow à n8n. Un miroir en retard peut taire une péremption, jamais en
   * inventer une, et la revue la rattrape à l'ouverture.
   */
  private async proposalRefs(sessionId: string, workflowId: string): Promise<ProposalRef[]> {
    const [proposals, workflow] = await Promise.all([
      this.prisma.workflowChatProposal.findMany({
        where: { sessionId },
        select: { id: true, summary: true, status: true, baseHash: true, appliedAt: true },
      }),
      this.prisma.workflow.findUnique({ where: { id: workflowId }, select: { hash: true } }),
    ]);
    return proposals.map((proposal) => ({
      id: proposal.id,
      summary: proposal.summary,
      state: proposalState(proposal, workflow?.hash ?? ''),
      appliedAt: proposal.appliedAt,
    }));
  }

  /** Octets d'une capture, pour la route qui la sert au navigateur. */
  async getAttachment(attachmentId: string): Promise<ChatAttachmentFile> {
    const attachment = await this.prisma.workflowChatAttachment.findUnique({
      where: { id: attachmentId },
      select: { mediaType: true, name: true, data: true },
    });
    if (!attachment) throw new NotFoundException(`Pièce jointe ${attachmentId} introuvable`);
    return { mediaType: attachment.mediaType, name: attachment.name, data: Buffer.from(attachment.data) };
  }

  /**
   * Relance une demande restée sans réponse.
   *
   * Le cas visé n'est PAS l'appel IA en erreur — celui-là écrit son constat dans
   * la conversation. C'est l'échec dont personne ne revient : le process tombe, la
   * requête est coupée, l'onglet se ferme. La demande est enregistrée, aucune
   * réponse ne vient, et rien ne le dit : on relance le lendemain par « c'est pas
   * fini ! ».
   */
  async retryLast(sessionId: string): Promise<SendMessageResult> {
    const session = await this.getSession(sessionId);
    const pending = unansweredRequest(session.messages);
    if (!pending) {
      throw new BadRequestException('Aucune demande en attente dans cette conversation.');
    }

    const last = session.messages[session.messages.length - 1];
    // Les pièces jointes repartent avec : sans elles, le rejeu répondrait à un
    // texte amputé de ce qui le rendait compréhensible.
    const joined = await this.loadAttachments([last], {});
    const attached = joined.get(last.id) ?? { images: [], files: [] };
    this.logger.log(`Rejeu de la demande ${last.id} (session ${sessionId})`);
    return this.runTurn(session, last, last.content, attached);
  }

  async deleteSession(sessionId: string): Promise<{ ok: true }> {
    await this.prisma.workflowChatSession.delete({ where: { id: sessionId } });
    return { ok: true };
  }

  /**
   * Relit les octets des pièces jointes de l'historique pour les rejouer au
   * modèle : sans elles, un « et là, c'est mieux ? » porte sur une capture qu'il
   * ne voit plus, ou sur un fichier dont il ne resterait que le nom, et il
   * répond sur le texte seul comme si de rien n'était. `pending` évite de
   * relire ce qu'on vient tout juste d'écrire.
   */
  private async loadAttachments(
    messages: ChatMessageWithAttachments[],
    pending: Record<string, TurnAttachments>,
  ): Promise<Map<string, TurnAttachments>> {
    const missing = messages
      .filter((message) => message.attachments.length > 0 && !pending[message.id])
      .flatMap((message) => message.attachments.map((attachment) => attachment.id));
    const loaded = new Map<string, WorkflowChatAttachment>();
    if (missing.length > 0) {
      const rows = await this.prisma.workflowChatAttachment.findMany({ where: { id: { in: missing } } });
      for (const row of rows) loaded.set(row.id, row);
    }
    return new Map(
      messages.map((message) => {
        const known = pending[message.id];
        if (known) return [message.id, known] as const;
        const rows = message.attachments
          .map((attachment) => loaded.get(attachment.id))
          .filter((row): row is WorkflowChatAttachment => Boolean(row));
        return [
          message.id,
          {
            images: rows
              .filter((row) => row.mediaType.startsWith('image/'))
              .map((row) => ({
                mediaType: row.mediaType as ChatImageMediaType,
                data: Buffer.from(row.data).toString('base64'),
                size: row.size,
              })),
            files: rows
              .filter((row) => !row.mediaType.startsWith('image/'))
              .map((row) => ({
                name: row.name ?? 'fichier.txt',
                mediaType: row.mediaType,
                text: Buffer.from(row.data).toString('utf8'),
                size: row.size,
              })),
          },
        ] as const;
      }),
    );
  }

  /**
   * L'historique tel qu'il part au modèle : captures rattachées au message,
   * fichiers rendus DANS son texte (un fichier n'a pas de bloc à lui dans l'API
   * des deux fournisseurs). Les deux budgets d'historique s'appliquent ici, une
   * fois pour toutes : au-delà, une conversation repaierait à chaque tour tout
   * ce qu'elle a jamais reçu.
   */
  private async withAttachments(
    messages: ChatMessageWithAttachments[],
    pending: Record<string, TurnAttachments>,
  ): Promise<AiMessage[]> {
    const joined = await this.loadAttachments(messages, pending);
    const carried = messages.map((message) => {
      const { images, files } = joined.get(message.id) ?? { images: [], files: [] };
      return {
        role: message.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        // Un message vide déjà en base — un tour d'avant ce garde-fou — rendrait
        // TOUTE la conversation inappelable : les fournisseurs refusent le
        // message, pas le tour, donc la relance échoue aussi. On lui redonne son
        // texte plutôt que de le retirer, pour ne pas coller deux messages
        // utilisateur l'un contre l'autre.
        content: message.content.trim()
          ? message.content
          : message.role === 'assistant'
            ? EMPTY_REPLY_NOTE
            : files.length > 0
              ? DEFAULT_FILE_PROMPT
              : DEFAULT_IMAGE_PROMPT,
        ...(images.length > 0 ? { images } : {}),
        ...(files.length > 0 ? { files } : {}),
      };
    });
    return limitHistoryFiles(limitHistoryImages(carried)).map(({ files, ...message }) => ({
      ...message,
      content: renderChatFiles(message.content, files ?? []),
    }));
  }

  /** Contexte courant du workflow, reconstruit à chaque tour (le workflow peut avoir bougé). */
  private async contextMessage(
    workflowId: string,
    workflow: { name: string; active: boolean; tags: string[]; instanceId: string },
    raw: N8nWorkflow,
    scope: ChatScopeEntry[],
    focusNodes?: string[],
    /** La demande du tour : c'est elle qui apparie les leçons apprises. */
    question = '',
  ): Promise<{ message: AiMessage; blank: boolean }> {
    const findings = await this.prisma.finding.findMany({
      where: { workflowId, resolvedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { severity: true, module: true, code: true, nodeName: true, message: true },
    });
    const context = buildChatContext(
      raw,
      { name: workflow.name, active: workflow.active, tags: workflow.tags },
      findings,
      {
        focusNodes,
        // Les sous-workflows sont ANNONCÉS et non servis : leur contenu se
        // demande à `read_workflow`, et une conversation qui n'en parle pas ne
        // paie pas leur JSON. Sans cette liste, le nœud « Execute Workflow » ne
        // portait qu'un id et l'assistant ignorait qu'il avait le droit d'aller
        // voir de l'autre côté.
        subWorkflows: scope
          .filter((member) => member.depth > 0)
          .map((member) => ({
            name: member.name,
            externalId: member.externalId,
            calledBy: member.calledBy,
            editable: !member.readOnly,
            ...(member.readOnlyReason ? { reason: member.readOnlyReason } : {}),
          })),
      },
    );
    // La mémoire va AVANT le JSON : c'est le cadrage, et il doit peser sur la
    // lecture de ce qui suit. Après, il passait pour une remarque de fin.
    const brief = await this.memory.brief(workflowId);
    const preamble = brief
      ? `Ce qui t'a déjà été dit sur ce workflow, et qui reste vrai :\n${brief}\n\n`
      : '';
    // Ce que n8n refuse DÉJÀ d'écrire, dit d'entrée et non au moment du refus :
    // il rejette le workflow entier, donc rien de ce qui sera proposé ne pourra
    // être appliqué tant que ça n'est pas corrigé — y compris une demande qui
    // n'a aucun rapport. L'apprendre après coup coûtait un aller-retour, et
    // laissait l'humain devant une proposition impossible à appliquer.
    // Ce que l'assistant a appris de ses corrections passées, et la question
    // qu'il doit encore à l'humain. Six règles au plus : le corpus grossit
    // librement, le PROMPT ne grossit pas — c'est toute la différence avec le
    // bloc « PIÈGES n8n » de `chat-prompt.ts`, payé en entier à chaque tour.
    const learned = await this.lessons.recall({ workflowId, raw, question });
    const lessons = learned.brief
      ? `Ce que tu as appris de corrections passées, et qui s'applique ici :\n${learned.brief}\n\n`
      : '';
    // Une correction dont on n'a pas su dire si elle venait d'une erreur ou d'un
    // changement d'avis. On demande UNE fois : la réponse vaut règle, le silence
    // vaut abandon.
    const pending = learned.question
      ? `AVANT DE RÉPONDRE — une correction faite à la main sur ce workflow est restée ` +
        `inexpliquée :\n${learned.question.text}\nPose la question en UNE ligne à la fin de ta ` +
        `réponse, sans y consacrer plus de place, et n'y reviens pas si on ne te répond pas.\n\n`
      : '';
    const refusals = writeRefusingFindings(await this.nodeCatalog.check(raw, workflow.instanceId));
    const blocked =
      refusals.length > 0
        ? `À CORRIGER EN PRIORITÉ — n8n refuse en l'état d'enregistrer ce workflow, et ce refus ` +
          `vaut pour TOUTE écriture, pas seulement celle qu'on va te demander :\n` +
          refusals
            .map((finding) => `- ${finding.nodeName ? `« ${finding.nodeName} » : ` : ''}${finding.message}`)
            .join('\n') +
          `\n\nCorrige-le dans le MÊME brouillon que ce qu'on te demande (ou seul, si on ne te demande ` +
          `rien d'autre) : relis le nœud avec read_node, réécris le paramètre entier avec le nom ` +
          `déclaré, et vérifie avec check_workflow avant de proposer.\n\n`
        : '';
    return {
      message: {
        role: 'user',
        content: `${preamble}${lessons}${pending}${blocked}Workflow analysé :\n${JSON.stringify(context)}`,
      },
      blank: isBlankWorkflow(raw),
    };
  }

  /**
   * État du workflow au moment du tour, redemandé à n8n : sur la copie locale,
   * l'assistant décrivait des nœuds tels qu'ils étaient il y a une heure et
   * proposait de corriger ce qui l'était déjà. n8n injoignable ne coupe pas la
   * conversation — on retombe sur la copie locale, et c'est l'application qui
   * refusera d'écrire à l'aveugle.
   */
  private async freshWorkflow(workflowId: string): Promise<{ workflow: WorkflowWithEnv; raw: N8nWorkflow }> {
    try {
      return await this.workflows.getFreshRaw(workflowId);
    } catch (error) {
      this.logger.warn(`Relecture n8n impossible (${workflowId}) : ${(error as Error).message}`);
      return this.workflows.getRaw(workflowId);
    }
  }

  async sendMessage(
    sessionId: string,
    content: string,
    options: SendMessageOptions = {},
  ): Promise<SendMessageResult> {
    const session = await this.getSession(sessionId);
    const text = content?.trim();
    let attached: TurnAttachments;
    try {
      attached = { images: parseChatImages(options.images), files: parseChatFiles(options.files) };
    } catch (error) {
      // Refus prévisible (format, poids, nombre) : une 400 qui dit quoi corriger,
      // pas un appel IA qui échouera après trente secondes d'attente.
      if (error instanceof ChatImageError || error instanceof ChatFileError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    // Une pièce jointe seule est une demande valable (« regarde cette erreur »,
    // un export lâché dans la zone) ; le texte manquant est alors écrit ici,
    // pour que la conversation reste lisible.
    const userText =
      text ||
      (attached.files.length > 0
        ? DEFAULT_FILE_PROMPT
        : attached.images.length > 0
          ? DEFAULT_IMAGE_PROMPT
          : '');
    if (!userText) throw new BadRequestException('Message vide');

    const rows = [
      ...attached.images.map((image) => ({
        mediaType: image.mediaType,
        name: null,
        size: image.size,
        data: Buffer.from(image.data, 'base64'),
      })),
      ...attached.files.map((file) => ({
        mediaType: file.mediaType,
        name: file.name,
        size: file.size,
        data: Buffer.from(file.text, 'utf8'),
      })),
    ];
    const userMessage = await this.prisma.workflowChatMessage.create({
      data: {
        sessionId,
        role: 'user',
        content: userText,
        ...(rows.length > 0 ? { attachments: { create: rows } } : {}),
      },
    });

    return this.runTurn(session, userMessage, userText, attached, options);
  }

  /**
   * Le tour, une fois la demande enregistrée.
   *
   * Isolé de `sendMessage` pour être REJOUABLE : une demande restée sans réponse
   * se relance sur son message d'origine, sans le dupliquer. Et tout ce qui suit
   * est sous filet — jusqu'ici seul l'appel IA l'était, alors que la construction
   * du contexte, la relecture des captures ou l'écriture finale peuvent échouer
   * elles aussi, et laissaient alors la demande sans la moindre suite.
   */
  private async runTurn(
    session: SessionWithMessages,
    userMessage: WorkflowChatMessage,
    userText: string,
    attached: TurnAttachments,
    options: SendMessageOptions = {},
  ): Promise<SendMessageResult> {
    this.progress.start(session.id);
    const signal = this.cancels.open(session.id);
    try {
      return await this.answer(session, userMessage, userText, attached, options, signal);
    } catch (error) {
      // Un tour arrêté n'est pas un tour en échec : on le lit sur le signal
      // qu'on tient, jamais sur la forme de l'erreur — l'abandon remonte tantôt
      // du SDK, tantôt de la boucle d'outils, sous des noms différents.
      if (this.cancels.wasCancelled(session.id)) return this.undoTurn(userMessage, userText, attached);
      this.progress.fail(session.id);
      const detail = (error as Error).message ?? 'erreur inconnue';
      this.logger.error(
        `Tour en échec (session ${session.id}) : ${detail}`,
        error instanceof Error ? error.stack : undefined,
      );
      return this.persistAssistantTurn(
        session,
        userMessage,
        userText,
        `⚠️ Ce tour a échoué avant que je puisse répondre : ${detail}\n\n` +
          'Ta demande est conservée telle quelle — relance-la depuis le bandeau au-dessus de la saisie.',
        null,
      );
    } finally {
      this.progress.finish(session.id);
      this.cancels.close(session.id);
    }
  }

  /**
   * Défait la demande d'un tour arrêté : le message est supprimé (ses captures
   * suivent en cascade) et rendu à la saisie. Le garder afficherait une demande
   * à laquelle rien ne répond, que le bandeau « restée sans réponse » proposerait
   * ensuite de relancer — exactement ce qu'on vient de refuser.
   */
  private async undoTurn(
    userMessage: WorkflowChatMessage,
    userText: string,
    attached: TurnAttachments,
  ): Promise<SendMessageResult> {
    this.logger.log(`Tour arrêté à la demande de l'utilisateur (session ${userMessage.sessionId})`);
    await this.prisma.workflowChatMessage.delete({ where: { id: userMessage.id } }).catch(() => undefined);
    return {
      userMessage,
      assistantMessage: null,
      proposalId: null,
      cancelled: { content: userText, images: attached.images, files: attached.files },
    };
  }

  private async answer(
    session: SessionWithMessages,
    userMessage: WorkflowChatMessage,
    userText: string,
    attached: TurnAttachments,
    options: SendMessageOptions = {},
    signal?: AbortSignal,
  ): Promise<SendMessageResult> {
    const sessionId = session.id;
    // Au rejeu, le message est DÉJÀ dans la session : l'ajouter le montrerait deux
    // fois au modèle, qui répondrait à une demande qu'il croirait répétée.
    const known = session.messages.some((message) => message.id === userMessage.id);
    const recent = (
      known ? session.messages : [...session.messages, { ...userMessage, attachments: [] }]
    ).slice(-HISTORY_LIMIT);
    const history: AiMessage[] = await this.withAttachments(
      recent,
      attached.images.length > 0 || attached.files.length > 0 ? { [userMessage.id]: attached } : {},
    );

    // Un scénario Make a son propre tour : contexte, outils, porte et proposition y
    // lisent un blueprint. Tout ce qui précède et ce qui suit reste commun.
    if (await this.isMakeScenario(session.workflowId)) {
      const made = await this.makeTurn.answer({
        sessionId,
        workflowId: session.workflowId,
        history,
        signal,
      });
      return this.persistAssistantTurn(
        session,
        userMessage,
        userText,
        made.reply,
        made.proposalId,
        made.trace,
        made.thinking,
      );
    }

    this.progress.step(sessionId, { label: 'Relecture du workflow depuis n8n', done: false });
    const { workflow, raw } = await this.freshWorkflow(session.workflowId);
    this.progress.step(sessionId, { label: 'Préparation du contexte', done: false });
    // Le périmètre du tour : ce workflow, et les sous-workflows qu'il appelle.
    // Tableau MUTABLE — `create_sub_workflow` l'agrandit en cours de tour, et les
    // outils doivent alors accepter comme cible le workflow qui vient de naître.
    const scope: ChatScopeEntry[] = await this.scope.build(session.workflowId);
    const context = await this.contextMessage(
      session.workflowId,
      workflow,
      raw,
      scope,
      options.focusNodes,
      userText,
    );
    // Un JSON n8n collé dans la demande est une BASE, et le modèle le lisait comme
    // une description : un IF collé disparaissait de la proposition. La consigne
    // va APRÈS le contexte, juste avant le message — c'est la dernière chose lue.
    // Le JSON arrive aussi bien collé dans la phrase que joint en fichier : on
    // cherche dans le message TEL QUE le modèle le reçoit, sinon un
    // `workflow.json` déposé au trombone n'aurait pas la consigne qui va avec.
    const pasted = findPastedWorkflows(renderChatFiles(userText, attached.files));
    if (pasted.length > 0) {
      context.message = {
        ...context.message,
        content: `${context.message.content}\n\n${pastedWorkflowBrief(pasted)}`,
      };
    }
    // Dernier brouillon soumis à `check_workflow`, PAR workflow visé. Repêchés si
    // la réponse finale n'apporte aucune proposition : les opérations sont les
    // mêmes, et elles ont déjà passé les contrôles. Une carte et non une seule
    // valeur, parce qu'un geste qui pose l'appel d'un côté et le contenu de
    // l'autre se vérifie en deux appels — n'en garder qu'un reviendrait à
    // repêcher une moitié de modification.
    const checkedDrafts = new Map<string, CheckedDraft>();
    const tools = buildChatTools(raw, {
      rootWorkflowId: session.workflowId,
      scope: () => scope,
      loadWorkflow: async (id) => (await this.freshWorkflow(id)).raw,
      createSubWorkflow: async (name) => {
        // Un seul par tour. C'est la seule écriture que l'assistant déclenche
        // sans revue : bornée ici et non seulement dans le prompt, parce qu'un
        // modèle qui tourne en rond sèmerait autant de workflows vides que de
        // passes, et qu'on les retrouverait dans la liste sans savoir d'où ils
        // viennent. Le refus est rendu à l'outil, qui saura s'en servir.
        if (scope.some((entry) => entry.created)) {
          throw new Error(
            'Un sous-workflow a déjà été créé dans ce tour. Propose d’abord son contenu et ' +
              'l’appel qui le déclenche ; la découpe suivante se fera au tour d’après.',
          );
        }
        const created = await this.workflowCreate.create(workflow.instanceId, name);
        // D'où il vient, retenu tout de suite : c'est la seule chose qui ne se
        // déduit pas de l'état du parc, et sans elle un workflow vide resté
        // après un refus ne se distingue plus d'un workflow qu'on vient d'ouvrir.
        await this.leftovers.record({
          workflowId: created.id,
          sessionId: session.id,
          parentWorkflowId: session.workflowId,
        });
        const entry: ChatScopeEntry = {
          workflowId: created.id,
          externalId: created.externalId,
          name: created.name,
          // Personne ne l'appelle encore : c'est justement ce que la proposition
          // du tour va poser, et le dire évite que le modèle croie l'appel fait.
          depth: 1,
          calledBy: [],
          created: true,
          readOnly: false,
        };
        scope.push(entry);
        this.logger.log(
          `Sous-workflow « ${created.name} » créé depuis la conversation ${sessionId} (n8n ${created.externalId})`,
        );
        return entry;
      },
      credentialsFor: (nodeType) => this.credentials.choicesFor(workflow.instanceId, nodeType),
      remember: (fact) => this.memory.remember(session.workflowId, fact, session.id),
      listConversations: () => this.history.list(session.workflowId, session.id),
      readConversation: (target) => this.history.read(session.workflowId, target),
      // La réponse de l'humain à la question qu'on lui devait : c'est le signal
      // le plus fiable du dispositif, et le seul qui tranche entre « je m'étais
      // trompé » et « j'ai changé d'avis ».
      answerCorrection: (answer) =>
        this.lessons.answerPending({ workflowId: session.workflowId, answer, author: null }),
      paramShapes: (candidate) => this.shapes.check(workflow.instanceId, candidate),
      // L'instance d'abord : c'est le n8n qui exécutera ce workflow. Le
      // catalogue mutualisé ne prend le relais que pour ce qu'elle n'a pas.
      describeNodeType: (nodeType) => this.nodeCatalog.describe(nodeType, workflow.instanceId),
      searchNodeTypes: (query) => this.nodeCatalog.search(query),
      schemaCheck: (candidate) => this.nodeCatalog.check(candidate, workflow.instanceId),
      // Le parc entier, et non la seule instance : un montage voyage, et le
      // workflow qu'on vient promouvoir n'a rien à copier chez lui.
      findExamples: async (search) =>
        findNodeExamples(await this.examples.workflows(), {
          ...search,
          excludeWorkflowId: session.workflowId,
        }),
      readExample: async (name) => {
        const found = await this.examples.byName(name);
        return found ? workflowSkeleton(found) : null;
      },
      // La doc du tiers, jamais retenue : c'est justement parce qu'elle bouge
      // qu'on va la chercher. Une source muette ne casse pas le tour — l'outil
      // rend l'échec au modèle, qui doit alors DIRE qu'il n'a pas la doc.
      searchDocs: (search) => this.docs.searchLibraries(search),
      readDocs: (search) => this.docs.readDocs(search),
      draftChecked: (draft) => {
        checkedDrafts.set(draft.workflowId, draft);
      },
    });

    // Réglages de l'appel, tenus à part : la passe de correction rejoue EXACTEMENT
    // le même tour — mêmes outils, même système — avec la plainte en plus. Un
    // second appel monté à côté finirait par diverger du premier.
    const call = {
      system: chatSystemPrompt({ blank: context.blank }),
      tools,
      maxRounds: MAX_TOOL_ROUNDS,
      maxTokens: 8192,
      effort: CHAT_EFFORT,
      // Porté par les réglages de l'appel et non passé à côté : la passe de
      // correction rejoue ce même objet, et elle doit s'arrêter comme le reste.
      signal,
      // Le raisonnement a lieu et est facturé de toute façon : seul son renvoi
      // est optionnel. On le demande ici parce qu'un humain le lit — les
      // analyses de masse, elles, ne le demandent pas.
      showThinking: true,
      // Un tour dure des dizaines de secondes et se joue derrière un appel
      // bloquant : sans ces étapes, l'écran n'a qu'un spinner à montrer.
      onProgress: (event: AiAgentEvent) => {
        if (event.type === 'round') {
          this.progress.step(sessionId, {
            label: event.round === 0 ? 'Analyse du workflow' : 'Poursuite de l’analyse',
            done: false,
          });
        } else if (event.type === 'tool') {
          this.progress.step(sessionId, toolProgressStep(event.name, event.input));
        } else if (event.type === 'tool-result' && event.failed) {
          this.progress.fail(sessionId);
        }
      },
    };
    const messages: AiMessage[] = [
      context.message,
      { role: 'assistant', content: 'Contexte du workflow reçu.' },
      ...history,
    ];

    let answer: string;
    let trace: AiToolTrace[] = [];
    let thinking: AiThinkingStep[] = [];
    // Ce que l'échec de la boucle laisse à dire, quand un brouillon vérifié
    // permet malgré tout de proposer quelque chose.
    let failureNote: string | null = null;
    try {
      const result = await this.ai.chatWithTools({ ...call, messages });
      answer = result.text;
      trace = result.trace;
      thinking = result.thinking;
    } catch (error) {
      // Un arrêt demandé n'a rien à écrire dans la conversation : il remonte
      // pour être traité comme tel. Sans cette relance, l'appel interrompu
      // ressemblait à un appel en panne, et le tour se soldait par un « l'appel
      // à l'IA a échoué » sous une demande qu'on venait justement de retirer.
      if (signal?.aborted) throw error;
      // L'échec reste DANS la conversation : en 500, il ne laissait qu'un toast
      // fugace et la demande semblait s'être perdue toute seule.
      const detail = (error as Error).message ?? 'erreur inconnue';
      this.logger.warn(`Appel IA en échec (session ${sessionId}) : ${detail}`);
      // La boucle rend ce qu'elle avait fait : un tour qui a lu des nœuds et
      // vérifié un brouillon ne repart pas les mains vides, et ce qui a été
      // payé reste visible sous la réponse.
      if (error instanceof AiToolLoopError) {
        trace = error.trace;
        thinking = error.thinking;
      }
      // Un brouillon que `check_workflow` a déjà déclaré propre vaut mieux qu'un
      // constat d'échec : le modèle n'a pas su conclure, mais la modification,
      // elle, est écrite et contrôlée. Rien n'est appliqué pour autant — elle
      // passe la porte et se relit en diff comme n'importe quelle proposition.
      if (!salvageable(checkedDrafts, scope, session.workflowId)) {
        return this.persistAssistantTurn(
          session,
          userMessage,
          userText,
          `⚠️ L'appel à l'IA a échoué : ${detail}`,
          null,
          trace,
          thinking,
        );
      }
      answer = '';
      failureNote = `⚠️ L'assistant n'a pas rendu de réponse (${detail}), mais la modification qu'il avait vérifiée pendant ce tour est proposée ci-dessous.`;
    }

    this.progress.step(sessionId, { label: 'Rédaction de la réponse', done: false });
    const turn = parseAssistantTurn(answer);
    let reply = failureNote ?? turn.reply;
    let proposalId: string | null = null;

    // Ce qu'on propose : ce que la réponse porte, ou — à défaut — le dernier
    // brouillon propre passé par `check_workflow` dans ce tour. Le modèle
    // sérialise ses opérations deux fois (l'outil, puis sa réponse) et perdre la
    // seconde suffisait à tout perdre : le message invitait à valider un diff
    // qui n'existait nulle part, et le tour d'après recommençait à l'identique.
    // Rien n'est écrit pour autant — une proposition se relit avant de partir.
    const draft = turn.proposal
      ? { ...turn.proposal, salvaged: false }
      : salvageable(checkedDrafts, scope, session.workflowId);

    if (draft) {
      try {
        // La proposition passe d'abord devant la porte, et si elle est refusée
        // elle repart au modèle avec le motif : c'est le seul moment où la
        // correction coûte encore un appel plutôt qu'un tour de conversation.
        // Traduit ce que le modèle a ÉCRIT — des noms de workflows — en cibles
        // écrivables. Une même fonction pour le tour et pour ses passes de
        // correction : si la correction résolvait autrement, le diff qu'on relit
        // ne serait pas celui qu'on écrit.
        const resolveTargets = (targets: AssistantProposalTarget[]): ResolvedTargets => {
          const parts: ProposalPartInput[] = [];
          const rootOperations: WorkflowEditOperation[] = [];
          const rejected: Array<{ workflow: string; reason: string }> = [];
          for (const target of targets) {
            const member = findScopeMember(scope, target.workflow);
            if (!member) {
              rejected.push({
                workflow: target.workflow,
                reason:
                  `hors du périmètre de cette conversation (périmètre : ` +
                  `${scope.map((entry) => `« ${entry.name} »`).join(', ')})`,
              });
              continue;
            }
            if (member.readOnly) {
              rejected.push({ workflow: target.workflow, reason: member.readOnlyReason ?? 'non modifiable' });
              continue;
            }
            if (member.workflowId === session.workflowId) {
              rootOperations.push(...target.operations);
              continue;
            }
            // Deux cibles pour un même workflow se recollent : le modèle découpe
            // parfois sa modification en deux entrées, et deux candidats bâtis
            // séparément s'écraseraient l'un l'autre à l'écriture.
            const known = parts.find((part) => part.workflowId === member.workflowId);
            if (known) known.operations.push(...target.operations);
            else parts.push({ workflowId: member.workflowId, operations: [...target.operations] });
          }
          return { parts, rootOperations, rejected };
        };

        const repaired = await this.repair.repair({
          workflowId: session.workflowId,
          draft,
          resolve: resolveTargets,
          call,
          messages,
          answer,
          onRound: (attempt) =>
            this.progress.step(sessionId, {
              label: `Correction de la modification refusée (passe ${attempt})`,
              done: false,
            }),
        });
        trace = [...trace, ...repaired.trace];
        thinking = [...thinking, ...repaired.thinking];
        // La correction a sa propre explication : la première décrivait la
        // modification refusée, et l'afficher au-dessus du diff corrigé ferait
        // deux choses différentes sur le même écran.
        if (repaired.reply) reply = repaired.reply;

        if (!repaired.draft) {
          reply = `${reply}\n\n${repairNote('abandoned', repaired.attempts)}`;
        } else {
          const resolved = resolveTargets(repaired.draft.targets);
          const { proposal, gate } = await this.proposals.create(
            session.workflowId,
            sessionId,
            repaired.draft.summary,
            [...repaired.draft.operations, ...resolved.rootOperations],
            resolved.parts,
          );
          proposalId = proposal.id;
          // Une cible refusée après les passes de correction n'est pas un détail
          // de forme : c'est une moitié du geste qui ne partira pas, et le diff
          // ne la montrera nulle part.
          if (resolved.rejected.length > 0) {
            reply =
              `${reply}\n\n> ⚠️ Ces workflows n'ont pas été retenus dans la modification : ` +
              resolved.rejected.map((entry) => `« ${entry.workflow} » (${entry.reason})`).join(', ') +
              '.';
          }
          if (resolved.parts.length > 0) {
            reply =
              `${reply}\n\n> 🔗 Cette modification touche aussi ${resolved.parts.length} ` +
              `sous-workflow${resolved.parts.length > 1 ? 's' : ''} : la revue les montre un par un, ` +
              `et « Appliquer » les écrit tous.`;
          }
          if (draft.salvaged && !failureNote) {
            reply = `${reply}\n\n> ℹ️ La réponse ne portait pas la modification : c'est le brouillon vérifié pendant ce tour qui est proposé ci-dessous.`;
          }
          if (repaired.outcome !== 'clean') {
            reply = `${reply}\n\n${repairNote(repaired.outcome, repaired.attempts)}`;
          }
          if (gate.reason) {
            // Le verdict est dit ici, pas seulement dans la revue : c'est dans la
            // conversation qu'on décide de redemander autre chose.
            reply = `${reply}\n\n> ${gate.blocked ? '⛔' : '⚠️'} ${gate.reason}`;
          }
        }
      } catch (error) {
        // Proposition invalide : on la remplace par un constat, la conversation continue.
        const detail =
          error instanceof WorkflowEditError
            ? error.message
            : ((error as Error).message ?? 'erreur inconnue');
        this.logger.warn(`Proposition rejetée (${session.workflowId}) : ${detail}`);
        // « refusée » se lisait comme un refus de l'humain, alors que personne
        // n'a rien décidé : c'est la plateforme qui n'a pas su en faire une
        // proposition. Le dire autrement évite d'aller chercher une action qu'on
        // n'a pas faite.
        reply = `${reply}\n\n> ⚠️ La plateforme n'a pas pu retenir la modification proposée : ${detail}`;
      }
    }

    if (turn.malformed && !proposalId) {
      // Une proposition a bien été rédigée, on n'a pas su la relire — et aucun
      // brouillon vérifié ne permettait de la repêcher.
      this.logger.warn(`Proposition illisible (session ${sessionId})`);
      reply = `${reply}\n\n> ⚠️ Une modification était proposée mais son format était illisible : rien n'a été retenu. Redemande-la en plusieurs fois, un nœud à la fois.`;
    }

    return this.persistAssistantTurn(session, userMessage, userText, reply, proposalId, trace, thinking);
  }

  private async isMakeScenario(workflowId: string): Promise<boolean> {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
      select: { instance: { select: { platform: true } } },
    });
    return workflow?.instance.platform === 'make';
  }

  /** Enregistre la réponse de l'assistant et rafraîchit la session (titre, date). */
  private async persistAssistantTurn(
    session: SessionWithMessages,
    userMessage: WorkflowChatMessage,
    userText: string,
    reply: string,
    proposalId: string | null,
    trace: AiToolTrace[] = [],
    thinking: AiThinkingStep[] = [],
  ): Promise<SendMessageResult> {
    const assistantMessage = await this.prisma.workflowChatMessage.create({
      data: {
        sessionId: session.id,
        role: 'assistant',
        content: reply.trim() ? reply : EMPTY_REPLY_NOTE,
        proposalId,
        ...(trace.length > 0 ? { toolTrace: trace as unknown as object } : {}),
        ...(thinking.length > 0 ? { thinking: thinking as unknown as object } : {}),
      },
    });

    await this.prisma.workflowChatSession.update({
      where: { id: session.id },
      data: {
        updatedAt: new Date(),
        ...(session.messages.length === 0 ? { title: userText.slice(0, TITLE_MAX) } : {}),
      },
    });

    return { userMessage, assistantMessage, proposalId };
  }
}

/**
 * Le brouillon vérifié, converti en proposition — ou `null` s'il n'y en a pas,
 * ou si le contrôle l'a recalé : un brouillon que `check_workflow` a refusé, le
 * modèle avait de bonnes raisons de ne pas le proposer.
 */
function salvageable(
  drafts: Map<string, CheckedDraft>,
  scope: ChatScopeEntry[],
  rootWorkflowId: string,
): {
  summary: string;
  operations: WorkflowEditOperation[];
  targets: AssistantProposalTarget[];
  salvaged: true;
} | null {
  const clean = [...drafts.values()].filter((draft) => draft.clean);
  if (clean.length === 0) return null;
  const operations = clean.find((draft) => draft.workflowId === rootWorkflowId)?.operations ?? [];
  const targets: AssistantProposalTarget[] = [];
  for (const draft of clean) {
    if (draft.workflowId === rootWorkflowId) continue;
    const member = scope.find((entry) => entry.workflowId === draft.workflowId);
    // Un brouillon vérifié sur un workflow sorti du périmètre entre-temps n'est
    // pas repêchable : on ne saurait plus le nommer dans la proposition.
    if (member) targets.push({ workflow: member.name, operations: draft.operations });
  }
  if (operations.length === 0 && targets.length === 0) return null;
  return {
    summary: summarizeEditOperations([...operations, ...targets.flatMap((target) => target.operations)]),
    operations,
    targets,
    salvaged: true,
  };
}

/**
 * Ce que l'assistant est allé chercher avant de répondre, en une ligne. Sans
 * elle, une réponse qui a relu trois nœuds et vérifié deux brouillons ressemble
 * à une réponse donnée de mémoire.
 */
