import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  EnvChain,
  EnvChainMode,
  EnvName,
  N8N_API_PORT,
  N8nApiPort,
  N8nInstanceConfig,
  N8nWorkflow,
  PromotionDirection,
  ReleaseLevel,
  RemoteTableReport,
  WebhookPathChange,
  Readiness,
  WorkflowDiff,
  adoptTargetLocators,
  canonicalLocatorNode,
  promotionReadiness,
  alignWebhookPaths,
  compareSemver,
  detectWorkflowEnv,
  CalleePublication,
  EntryClash,
  checkedCallees,
  planCalleePublication,
  findEntryClashes,
  withDeclaredEntryPath,
  envIds,
  envLineage,
  diffWorkflows,
  envFamilyKey,
  envChainPlan,
  extractSubWorkflowRefs,
  INITIAL_VERSION,
  nextVersion,
  parseSemver,
  remapSubWorkflowRefs,
  renameWithVersion,
  versionFromName,
  withEnvSuffix,
  workflowFamilyKey,
  workflowFamilyName,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { ModuleRegistryService } from '../../infra/modules-registry/module-registry.service';
import {
  REMOTE_SCHEMA_MODULE_ID,
  RemoteSchemaCheckService,
} from '../../infra/remote-schema/remote-schema-check.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { WorkflowSyncService } from '../workflows/workflow-sync.service';
import { InstancesService } from '../instances/instances.service';
import { MappingLabels, MappingValues } from './mapping-replacements';
import { switchResources } from './switch-resources';
import { ensureEnvTags } from './ensure-env-tags';
import { UnmappedResource, findUnmappedResources } from './unmapped-resources';
import {
  SubWorkflowMapping,
  TargetWorkflow,
  resolveSubWorkflows,
  subWorkflowTargets,
  targetWorkflows,
} from './sub-workflow-mapping';
import { ChainStep, KnownExemplar, resolveChainSteps } from './promotion-chain';
import { ReleaseStateService } from './release-state.service';
import { VersionProposalService } from './version-proposal.service';
import { WorkflowLockService } from '../../infra/workflow-lock/workflow-lock.service';
import { PromotionPublishService, PublishLeg, PublishRunView } from './promotion-publish.service';

export interface PromoteInput {
  /** Peut être l'instance source elle-même : la cible est alors l'exemplaire `targetEnv`. */
  targetInstanceId: string;
  /** Optionnel : bascule aussi les ressources vers cet env (mappings) et suffixe le nom. */
  targetEnv?: EnvName;
  /** Passe outre les gates bloquants (findings error, cas de test non conformes) — décision humaine. */
  force?: boolean;
  /**
   * Promeut d'abord les sous-workflows appelés qui manquent sur la cible, en
   * cascade (les plus profonds d'abord). Ne crée que ce qui manque : un workflow
   * déjà présent sur la cible sous le nom attendu n'est jamais touché.
   */
  cascade?: boolean;
  /**
   * Digit à incrémenter, ou `none` pour reprendre le numéro de la source sans
   * l'incrémenter. Absent, c'est la proposition du preview qui s'applique (calcul
   * déterministe affiné par l'IA) — jamais un niveau deviné à l'aveugle.
   */
  bump?: ReleaseLevel;
  /** Version imposée à la main (« 2.0.0 »), qui court-circuite `bump`. */
  version?: string;
  /**
   * Promeut d'abord dans chaque env intermédiaire déclaré (dev → preprod → prod),
   * de sorte qu'aucune étape ne soit sautée. C'est la réponse par défaut à un
   * saut d'étape : traverser plutôt qu'ignorer.
   */
  throughChain?: boolean;
  /** Assume le saut d'étape (mode `warn` uniquement) : décision humaine, dite explicitement. */
  confirmSkip?: boolean;
  /**
   * Lit les tables de la CIBLE (ressources déjà basculées, credentials de la
   * cible) avant d'écrire : une colonne absente là-bas bloque, contournable par
   * `force`. Opt-in côté API — chaque lecture crée une sonde dans n8n —, coché
   * par défaut dans l'écran.
   */
  checkRemote?: boolean;
  /**
   * Déplace vers le path suffixé de SON env tout autre workflow de la cible qui
   * sert déjà une URL que la promotion va poser (la dev restée sur l'uuid nu de son
   * formulaire, promue tout droit vers la prod). Absent = oui : c'est la convention,
   * et l'aperçu le dit. Refusé, un détenteur ACTIF bloque (contournable par `force`).
   */
  moveClashing?: boolean;
  /**
   * Publie, avant d'écrire la cible, les sous-workflows appelés restés en brouillon
   * sur un n8n à versions — ceux qui ne démarrent rien seuls. Sans eux, n8n refuse
   * d'activer la cible, et d'écrire une cible déjà publiée. Absent = oui.
   */
  publishCallees?: boolean;
  /**
   * Une fois tout écrit, publie sur la cible chaque exemplaire publié dans la
   * source — appelés d'abord — et met la chaîne en pause au premier refus. Absent =
   * non : promouvoir ne déploie pas, sauf à le demander.
   */
  publishLikeSource?: boolean;
}

/** Tables distantes de la cible confrontées au workflow promu. */
export interface PromoteRemoteSchemaGate {
  ok: boolean;
  /** Tables et colonnes absentes sur la cible : bloquant. */
  missing: Array<{ code: string; message: string; nodeName?: string; suggestion?: string }>;
  /** Tables qu'on n'a pas pu lire : jamais un feu vert, jamais un blocage non plus. */
  unverified: Array<{ table: string; reason: string }>;
  tables: RemoteTableReport[];
}

/** Sous-workflow à créer sur la cible avant le workflow qui l'appelle. */
export interface CascadeItem {
  /** Id du workflow SOURCE côté plateforme (c'est lui qu'on promeut). */
  workflowId: string;
  sourceName: string;
  targetName: string;
}

/** Finding bloquant, tel qu'affiché dans le preview — de quoi juger sans quitter la modale. */
export interface PromoteFinding {
  id: string;
  module: string;
  code: string;
  message: string;
  nodeName?: string;
  /** Correctif proposé par la règle (`data.suggestion`), quand elle en porte un. */
  suggestion?: string;
}

/** Au-delà, la liste noierait le preview : le compte total reste exact. */
const FINDINGS_PREVIEW_LIMIT = 20;

/**
 * Où en est le numéro de version, et celui que la promotion posera. La prochaine
 * version part de la PLUS HAUTE du workflow métier, tous envs confondus : repartir
 * de la seule source rejouerait un numéro déjà servi ailleurs.
 */
export interface PromoteVersionGate {
  /** Faux quand la cible porte une version plus haute que la source : elle a reçu quelque chose que la source n'a pas. */
  ok: boolean;
  /** Ce que porte chaque exemplaire connu du workflow métier, aujourd'hui. */
  current: Array<{ env: EnvName | null; instanceName: string; name: string; version: string | null }>;
  sourceVersion: string | null;
  targetVersion: string | null;
  /** Version que la promotion posera sur TOUS les exemplaires qu'elle touche. */
  next: string;
  /**
   * Nom de la cible une fois le numéro reporté dedans, ou null quand le nom n'en
   * porte pas : promouvoir renomme, et ça ne doit pas se découvrir après coup.
   */
  nextName: string | null;
  level: ReleaseLevel;
  /** Ce qui, dans le changement, décide du digit — ou de la reprise. */
  reason: string;
  /** Qui a tranché le niveau : le modèle, la règle déterministe, ou l'humain. */
  source: 'ai' | 'rules' | 'human';
}

/** Ce que la chaîne d'environnements déclarée dit de cette promotion. */
export interface PromoteChainGate {
  /** Faux quand la promotion saute une étape déclarée sans la traverser. */
  ok: boolean;
  mode: EnvChainMode;
  chain: EnvChain;
  from: EnvName | null;
  to: EnvName | null;
  direction: PromotionDirection;
  /** Étapes déclarées qu'une promotion directe sauterait. */
  skipped: EnvName[];
  /** Ce que `throughChain` fera avant la cible : une promotion par étape sautée. */
  steps: ChainStep[];
  /** `throughChain` demandé : plus rien n'est sauté. */
  through: boolean;
}

/** Quality gates : ce qui devrait être vert avant de pousser vers une autre instance. */
export interface PromoteGates {
  /** Findings de sévérité error non résolus (secret en clair, ref cassée…). */
  findings: { ok: boolean; errors: number; items: PromoteFinding[] };
  /** Cas de test enregistrés — null si le workflow n'en a aucun. */
  tests: { ok: boolean; total: number; passed: number; failed: number; neverRun: number } | null;
  /** Credentials du candidat jamais vus sur la cible (heuristique par nom). */
  credentials: { ok: boolean; missing: string[] };
  /**
   * Sous-workflows appelés : rattachés à leur contrepartie sur la cible, ou non.
   * `dynamic` (id choisi à l'exécution) n'est jamais bloquant — rien à rattacher.
   */
  subWorkflows: {
    ok: boolean;
    total: number;
    mapped: number;
    missing: number;
    dynamic: number;
    cascade: number;
    /** Contreparties trouvées sur la cible, mais archivées côté n8n. */
    archived: number;
  };
  version: PromoteVersionGate;
  chain: PromoteChainGate;
  /** null : contrôle non demandé, ou module `remote-schema` désactivé. */
  remoteSchema: PromoteRemoteSchemaGate | null;
}

export interface PromotePreview {
  sourceName: string;
  targetInstanceName: string;
  targetName: string;
  /** `update` : un workflow du même nom existe sur la cible et sera écrasé. */
  mode: 'create' | 'update';
  targetN8nId?: string;
  /** Écraser un workflow ACTIF sur la cible = toucher la prod : l'UI doit le crier. */
  targetActive?: boolean;
  /** La cible écrasée est verrouillée : l'écriture demandera un forçage justifié. */
  targetLocked?: boolean;
  /** La cible du même nom est archivée dans n8n : l'API refuse de la modifier. */
  targetArchived?: boolean;
  replacements: number;
  /** Ressources basculées, par nœud, avec leur nom avant/après (quand le mapping en porte un). */
  switched: Array<{ nodeName: string; from: string; to: string }>;
  /** Ressources basculables qu'aucun mapping ne couvre : elles partent telles quelles. */
  unmapped: UnmappedResource[];
  /** Sous-workflows appelés et ce qu'ils viseront sur la cible. */
  subWorkflows: SubWorkflowMapping[];
  /** Sous-workflows qui seront créés sur la cible avant celui-ci (option cascade). */
  cascade: CascadeItem[];
  gates: PromoteGates;
  /** Raisons qui bloquent la promotion (contournables par force=true, sauf si `forceable` est faux). */
  blockers: string[];
  /**
   * Faux quand un blocage ne se contourne pas : n8n refuse d'écrire sur un workflow
   * archivé, forcer ne ferait que rejouer le même 400.
   */
  forceable: boolean;
  /**
   * La promotion saute une étape déclarée et le mode est `warn` : elle part quand
   * même, mais seulement sur un `confirmSkip` explicite — coché par un humain, pas
   * déduit d'un `force` qui sert déjà à passer outre findings et tests.
   */
  needsSkipConfirm: boolean;
  /** Ce qui change sur la cible (mode update uniquement). */
  diff?: WorkflowDiff;
  /** Ce qu'il reste à un humain avant d'appliquer : rien, des décisions, ou un refus. */
  readiness: Readiness;
  /**
   * Points d'entrée : `preserved` = paths repris de la cible (son URL ne bouge pas),
   * `changes` = paths recalculés pour l'env cible faute de contrepartie.
   */
  webhookPaths: { preserved: WebhookPathChange[]; changes: WebhookPathChange[] };
  /** URLs que la cible va servir, déjà tenues sur l'instance cible par un autre workflow. */
  entryClashes: EntryClash[];
  /** Sous-workflows appelés, en brouillon sur la cible : publiés au passage, ou laissés à l'humain. */
  callees: CalleePublication;
}

/**
 * Le sort du numéro de version DANS le nom n8n, exemplaire par exemplaire. Sans
 * lui la promotion annonçait « posé en 1.3.0 » pendant que n8n continuait
 * d'afficher « (1.2.2) » : le renommage est délibérément non bloquant, mais son
 * échec partait dans un `warn` que personne ne lit.
 */
export interface PromoteRename {
  /** Le nom porté avant le geste. */
  name: string;
  /** Le nom écrit dans n8n — égal à `name` dès que rien n'était à faire. */
  renamed: string;
  /**
   * `renamed` : le nom a changé dans n8n. `already` : il portait déjà ce numéro
   * (la cible, écrite d'emblée sous son nouveau nom). `no-marker` : le nom ne
   * porte pas de marqueur `(1.2.3)`, on n'impose pas cette notation.
   * `failed` : n8n a refusé — le numéro est posé en base, le nom retarde.
   * `locked` : l'exemplaire est verrouillé, son nom n'est pas touché.
   */
  status: 'renamed' | 'already' | 'no-marker' | 'failed' | 'locked';
  /** Le refus de n8n, verbatim, quand `status` vaut `failed`. */
  error?: string;
}

export interface PromoteResult {
  mode: 'create' | 'update';
  targetN8nId?: string;
  targetName: string;
  replacements: number;
  localWorkflowId?: string;
  /** Sous-workflows créés en cascade avant celui-ci. */
  cascaded: Array<{ targetName: string; targetN8nId?: string }>;
  /** Version posée sur tous les exemplaires touchés (source comprise). */
  version?: string;
  /** Étapes intermédiaires traversées avant la cible (option `throughChain`). */
  through?: Array<{ env: EnvName; instanceName: string; targetName: string }>;
  /** Ce que la version est devenue dans le NOM de chaque exemplaire touché. */
  renames?: PromoteRename[];
  /** Autres workflows déplacés sur un path à eux pour libérer l'URL de la cible. */
  moved?: MovedEntry[];
  /** Sous-workflows publiés au passage, et ceux qui restent à publier à la main. */
  callees?: { published: string[]; manual: Array<{ name: string; reason: string }> };
  /** Chaîne « publier comme la source », quand elle est demandée. */
  publication?: PublishRunView;
  /** La chaîne n'a pas pu être préparée : la promotion est faite, la publication reste à la main. */
  publicationError?: string;
}

export interface MovedEntry {
  workflowName: string;
  node: string;
  from: string;
  to: string;
}

/**
 * Promotion d'un workflow vers une autre instance n8n — ou vers un autre env de la
 * MÊME instance, quand dev et prod y cohabitent sous des noms suffixés (« X - DEV »
 * poussé sur « X - PROD ») : c'est le geste qui renvoie un travail de dev sur la
 * prod, là où « copier vers un env » en referait une énième copie à côté.
 *
 * les ressources sont basculées vers l'env cible (mappings, comme la duplication),
 * puis le workflow est créé sur la cible — ou **écrasé** s'il y existe déjà sous
 * le même nom, ce qui rend la promotion rejouable : c'est le nom qui fait le lien
 * entre les deux instances, il n'y a pas de table de correspondance à entretenir.
 *
 * Toujours prévisualiser avant d'appliquer : le preview dit si on crée ou si on
 * écrase, et montre le diff avec l'existant.
 */
@Injectable()
export class InstancePromoterService {
  private readonly logger = new Logger(InstancePromoterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowsService,
    private readonly sync: WorkflowSyncService,
    private readonly instances: InstancesService,
    private readonly settings: PlatformSettingsService,
    private readonly versions: VersionProposalService,
    private readonly release: ReleaseStateService,
    @Inject(N8N_API_PORT) private readonly n8n: N8nApiPort,
    private readonly registry: ModuleRegistryService,
    private readonly remoteSchema: RemoteSchemaCheckService,
    private readonly locks: WorkflowLockService,
    private readonly publisher: PromotionPublishService,
  ) {}

  async preview(workflowId: string, input: PromoteInput): Promise<PromotePreview> {
    // Seul le preview paie la proposition IA : les préparations internes (une par
    // étape de chaîne, une par sous-workflow en cascade) retombent sur la règle.
    const prepared = await this.prepare(workflowId, input, { proposeVersion: true });
    const existing = prepared.existing;
    const targetLocked = await this.isTargetLocked(input.targetInstanceId, existing);
    return {
      sourceName: prepared.sourceName,
      targetInstanceName: prepared.targetInstanceName,
      targetName: prepared.targetName,
      mode: existing ? 'update' : 'create',
      targetN8nId: existing?.id !== undefined ? String(existing.id) : undefined,
      targetActive: existing?.active,
      targetArchived: existing?.isArchived === true ? true : undefined,
      replacements: prepared.replacements,
      switched: prepared.switched,
      unmapped: prepared.unmapped,
      subWorkflows: prepared.subWorkflows,
      cascade: prepared.cascade,
      gates: prepared.gates,
      blockers: prepared.blockers,
      forceable: prepared.hardBlockers.length === 0,
      needsSkipConfirm: prepared.needsSkipConfirm,
      diff: prepared.diff,
      webhookPaths: prepared.webhookPaths,
      entryClashes: prepared.entryClashes,
      callees: prepared.callees,
      targetLocked,
      readiness: promotionReadiness({
        mode: existing ? 'update' : 'create',
        targetActive: existing?.active,
        targetLocked,
        diffHasChanges: prepared.diff?.hasChanges ?? false,
        blockers: prepared.blockers,
        forceable: prepared.hardBlockers.length === 0,
        needsSkipConfirm: prepared.needsSkipConfirm,
        chain: prepared.gates.chain,
      }),
    };
  }

  async promote(workflowId: string, input: PromoteInput): Promise<PromoteResult> {
    const prepared = await this.prepare(workflowId, input);
    // Blocage non contournable : forcer ne ferait que rejouer le 400 de n8n.
    if (prepared.hardBlockers.length > 0) {
      throw new BadRequestException(prepared.hardBlockers.join(' ; '));
    }
    // La chaîne d'envs est un refus à part : en mode `block` rien ne la contourne,
    // et en mode `warn` c'est `confirmSkip` qui l'ouvre — pas `force`, qui sert
    // déjà à passer outre findings et tests. Confondre les deux ferait passer un
    // saut d'étape à celui qui voulait seulement forcer un test rouge.
    if (prepared.chainBlocker) throw new BadRequestException(prepared.chainBlocker);
    if (prepared.blockers.length > 0 && !input.force) {
      throw new BadRequestException(
        `Promotion bloquée : ${prepared.blockers.join(' ; ')}. Repasse les gates au vert (ou force en connaissance de cause).`,
      );
    }

    // Version arrêtée AVANT la première écriture : chaque étape resynchronise les
    // exemplaires, et recalculer entre deux étapes donnerait un numéro par env.
    const version = this.chosenVersion(input, prepared.gates.version);

    // Le chemin : les étapes intermédiaires déclarées, puis la cible. Sans
    // `throughChain`, c'est la cible et rien d'autre.
    const route = [
      ...(input.throughChain ? prepared.gates.chain.steps : []).map((step) => ({
        targetInstanceId: step.instanceId,
        targetEnv: step.env,
        instanceName: step.instanceName,
      })),
      { targetInstanceId: input.targetInstanceId, targetEnv: input.targetEnv, instanceName: '' },
    ];

    // Verrous vérifiés sur TOUT le chemin avant la première écriture : buter sur la
    // prod verrouillée après avoir déjà écrit la preprod laisserait un geste à moitié fait.
    const legs =
      route.length === 1
        ? [{ instanceId: input.targetInstanceId, prepared }]
        : await Promise.all(
            route.map(async (leg) => ({
              instanceId: leg.targetInstanceId,
              prepared: await this.prepare(workflowId, { ...input, ...leg, throughChain: false }),
            })),
          );
    const lockedIds: string[] = [];
    for (const leg of legs)
      lockedIds.push(...(await this.writtenLocalIds(leg.instanceId, leg.prepared, input)));
    await this.locks.assertWritable(lockedIds);

    const cascaded: PromoteResult['cascaded'] = [];
    const moved: MovedEntry[] = [];
    const callees: NonNullable<PromoteResult['callees']> = { published: [], manual: [] };
    const addCallees = (more?: PromoteResult['callees']) => {
      callees.published.push(...(more?.published ?? []));
      callees.manual.push(...(more?.manual ?? []));
    };
    const through: NonNullable<PromoteResult['through']> = [];
    const written: PublishLeg[] = [];
    const touched: string[] = [workflowId];
    let last: PromoteResult | null = null;

    for (const leg of route) {
      // `throughChain: false` : chaque étape est une promotion ordinaire vers l'env
      // suivant, elle ne saute rien et n'a donc pas à rejouer le contrôle de chaîne.
      const legInput: PromoteInput = { ...input, ...leg, throughChain: false };
      // Une seule étape : c'est exactement la préparation qu'on vient de faire.
      const legPrepared = route.length === 1 ? prepared : await this.prepare(workflowId, legInput);

      // Cascade : les sous-workflows manquants d'abord, les plus profonds en tête, pour
      // que chacun trouve les siens déjà créés. Rien n'est écrasé au passage — un
      // workflow déjà présent sur la cible n'est pas « manquant », donc pas dans le plan.
      for (const item of legPrepared.cascade) {
        const child = await this.push(item.workflowId, { ...legInput, cascade: false }, true);
        if (!child) {
          this.logger.log(`« ${item.targetName} » existe déjà sur la cible : laissé tel quel`);
          continue;
        }
        // Le sous-workflow créé au passage n'hérite PAS de la version de son
        // appelant : c'est un autre workflow, avec sa propre lignée, et il prendra
        // son numéro le jour où on le promeut pour lui-même.
        cascaded.push({ targetName: child.targetName, targetN8nId: child.targetN8nId });
        moved.push(...(child.moved ?? []));
        addCallees(child.callees);
      }

      // Re-préparé après la cascade : c'est là que les ids fraîchement créés entrent
      // dans le candidat.
      const result = await this.push(workflowId, { ...legInput, cascade: false }, false, version);
      if (result?.localWorkflowId) touched.push(result.localWorkflowId);
      if (result?.targetN8nId) {
        written.push({
          instanceId: leg.targetInstanceId,
          env: leg.targetEnv ?? null,
          targetN8nId: result.targetN8nId,
          localWorkflowId: result.localWorkflowId,
        });
      }
      moved.push(...(result?.moved ?? []));
      addCallees(result?.callees);
      if (leg !== route[route.length - 1] && leg.targetEnv) {
        through.push({ env: leg.targetEnv, instanceName: leg.instanceName, targetName: result!.targetName });
      }
      last = result;
    }

    const renames = await this.stampVersion(touched, version);
    const published = input.publishLikeSource ? await this.publishLikeSource(workflowId, written) : {};
    return { ...last!, cascaded, version, through, renames, moved, callees, ...published };
  }

  /**
   * Après toutes les écritures, jamais entre deux : une pause ne laisse ainsi qu'une
   * publication à finir, pas une promotion à moitié écrite. Un échec de préparation
   * ne défait pas la promotion réussie — il est rendu.
   */
  private async publishLikeSource(
    workflowId: string,
    legs: PublishLeg[],
  ): Promise<Pick<PromoteResult, 'publication' | 'publicationError'>> {
    try {
      return { publication: await this.publisher.start(workflowId, legs) };
    } catch (error) {
      this.logger.warn(`Publication comme la source impossible : ${(error as Error).message}`);
      return { publicationError: (error as Error).message };
    }
  }

  /**
   * Version retenue : celle saisie à la main si elle est lisible, sinon la prochaine
   * calculée sur le niveau choisi. Une saisie illisible est un refus franc — poser
   * « v2 » ou « 2.0 » casserait toute comparaison ultérieure en silence.
   */
  private chosenVersion(input: PromoteInput, gate: PromoteVersionGate): string {
    const manual = input.version?.trim();
    if (!manual) return gate.next;
    if (!parseSemver(manual)) {
      throw new BadRequestException(`« ${manual} » n'est pas une version sémantique (attendu : 1.2.3).`);
    }
    return manual;
  }

  /**
   * Pose la version sur les exemplaires que la promotion vient de toucher — et sur
   * eux SEULS : un env resté à l'écart ne porte pas un numéro qu'il n'a jamais reçu.
   * La source en fait partie, elle porte exactement le contenu qui vient de partir.
   *
   * Le dernier snapshot de chaque exemplaire est estampillé au passage : c'est lui
   * qui fait la ligne « 1.2.11 » dans l'historique, là où `Workflow.version` ne dit
   * que l'état courant.
   */
  private async stampVersion(workflowIds: string[], version: string): Promise<PromoteRename[]> {
    const renames: PromoteRename[] = [];
    for (const id of new Set(workflowIds)) {
      await this.prisma.workflow.update({ where: { id }, data: { version } });
      const latest = await this.prisma.workflowVersion.findFirst({
        where: { workflowId: id },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (latest) {
        await this.prisma.workflowVersion.update({ where: { id: latest.id }, data: { semver: version } });
      }
      const rename = await this.renameInN8n(id, version);
      if (rename) renames.push(rename);
    }
    return renames;
  }

  /**
   * Reporte le numéro dans le NOM du workflow, côté n8n — la colonne ne se voit que
   * dans la plateforme, et laisser n8n afficher « (1.1.4) » sous une version 1.2.2
   * fait deux numéros pour un même workflow.
   *
   * Les exemplaires poussés sont déjà écrits sous leur nouveau nom : il ne reste
   * que la source. Un échec ici ne défait pas une promotion réussie — le numéro est
   * posé, c'est le libellé qui retarde —, mais il est RENDU à l'appelant : un
   * renommage muet faisait annoncer « posé en 1.3.0 » à côté d'un n8n resté en
   * « (1.2.2) », et la seule trace en était un `warn` dans les logs du conteneur.
   */
  private async renameInN8n(workflowId: string, version: string): Promise<PromoteRename | null> {
    const row = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
      select: { name: true, externalId: true, instanceId: true },
    });
    if (!row) return null;
    const envs = await this.settings.declaredEnvIds();
    const renamed = renameWithVersion(row.name, version, envs);
    if (renamed === row.name) {
      // Deux immobilités à ne pas confondre : le nom porte déjà ce numéro (la
      // cible, écrite d'emblée sous son nouveau nom), ou il n'en porte aucun et
      // n'en recevra jamais. La première est un succès, la seconde une explication.
      const status = versionFromName(row.name, envs) === version ? 'already' : 'no-marker';
      return { name: row.name, renamed, status };
    }
    // Accessoire : un exemplaire verrouillé (la source, le plus souvent) garde son
    // nom, la promotion ne s'arrête pas pour un libellé.
    if (!(await this.locks.canWrite(workflowId)))
      return { name: row.name, renamed: row.name, status: 'locked' };
    try {
      const config = await this.instances.getConfig(row.instanceId);
      const live = await this.n8n.getWorkflow(config, row.externalId);
      await this.n8n.updateWorkflow(config, row.externalId, { ...live, name: renamed });
      const fresh = await this.n8n.getWorkflow(config, row.externalId);
      await this.sync.upsertWorkflow(row.instanceId, fresh);
      this.logger.log(`« ${row.name} » renommé « ${renamed} » dans n8n`);
      return { name: row.name, renamed, status: 'renamed' };
    } catch (error) {
      const message = (error as Error).message;
      this.logger.warn(
        `Renommage KO sur « ${row.name} » (${message}) : la version ${version} est posée, le nom dans n8n reste à jour à la main.`,
      );
      return { name: row.name, renamed, status: 'failed', error: message };
    }
  }

  /**
   * Pousse un workflow sur la cible (création, ou écrasement du même nom).
   * `createOnly` rend la main sans rien toucher si la cible existe déjà — c'est ce
   * qui garantit qu'une cascade ne réécrit jamais un workflow existant.
   */
  private async push(
    workflowId: string,
    input: PromoteInput,
    createOnly = false,
    version?: string,
  ): Promise<PromoteResult | null> {
    const prepared = await this.prepare(workflowId, input);
    const { candidate, existing, targetConfig } = prepared;
    // La cible est retrouvée sous le nom qu'elle porte, puis écrite sous le nouveau :
    // le numéro que l'équipe lit dans n8n suit celui que la plateforme vient de poser.
    // Un nom sans numéro n'en reçoit pas : on n'impose pas cette notation.
    const targetName = version
      ? renameWithVersion(prepared.targetName, version, await this.settings.declaredEnvIds())
      : prepared.targetName;
    // Avant même le raccourci `createOnly` : un homonyme archivé n'est pas « déjà là »,
    // c'est un mur — le laisser passer pour rien ferait croire la cascade complète.
    if (prepared.hardBlockers.length > 0) throw new BadRequestException(prepared.hardBlockers.join(' ; '));
    if (createOnly && existing) return null;
    // Rejoué à chaque écriture — sous-workflow en cascade, étape de chaîne — et non
    // au seul appelant : c'est la table de CET exemplaire qui refusera la ligne.
    const remote = prepared.gates.remoteSchema;
    if (remote && !remote.ok && !input.force) {
      throw new BadRequestException(
        `Promotion de « ${prepared.targetName} » bloquée : ${remoteSchemaBlocker(remote)}`,
      );
    }

    // Le détenteur d'abord : s'il échoue, la cible n'a pas encore été écrite sur une
    // URL qu'elle ne pourrait pas servir.
    const moved =
      input.moveClashing === false ? [] : await this.moveClashing(prepared.entryClashes, input, targetConfig);
    // Les appelés AVANT la cible : n8n refuse de publier un workflow dont un appelé est en
    // brouillon, et l'écriture d'une cible déjà publiée la republie.
    const callees =
      input.publishCallees === false
        ? { published: [], manual: [] }
        : await this.publishCallees(candidate as unknown as N8nWorkflow, input, targetConfig);

    let targetN8nId: string | undefined;
    let mode: 'create' | 'update';
    if (existing?.id !== undefined) {
      mode = 'update';
      targetN8nId = String(existing.id);
      // L'état actif/inactif reste celui de la cible : promouvoir ne déploie pas.
      // Le pinData de la source ne suit pas : un bouchon posé pour un essai en dev
      // n'a rien à faire sur la cible, où il ferait servir de la donnée factice.
      await this.n8n.updateWorkflow(targetConfig, targetN8nId, {
        ...candidate,
        name: targetName,
        pinData: undefined,
      });
    } else {
      mode = 'create';
      const created = await this.n8n.createWorkflow(targetConfig, {
        ...candidate,
        id: undefined,
        name: targetName,
        active: false,
        pinData: undefined,
      });
      targetN8nId = created.id !== undefined ? String(created.id) : undefined;
    }

    if (targetN8nId && input.targetEnv) {
      await ensureEnvTags(this.n8n, targetConfig, targetN8nId, prepared.sourceTags, input.targetEnv).catch(
        (error) => this.logger.warn(`Tags KO sur « ${targetName} » : ${(error as Error).message}`),
      );
    }

    // Sync du workflow cible en DB : workflow.synced → snapshot versioning côté cible.
    let localWorkflowId: string | undefined;
    if (targetN8nId) {
      const fresh = await this.n8n.getWorkflow(targetConfig, targetN8nId);
      const event = await this.sync.upsertWorkflow(input.targetInstanceId, fresh);
      localWorkflowId = event.workflowId;
    }

    this.logger.log(
      `« ${prepared.sourceName} » promu vers ${prepared.targetInstanceName} : « ${targetName} » #${targetN8nId} (${mode}, ${prepared.replacements} remplacements)`,
    );
    return {
      mode,
      targetN8nId,
      targetName,
      replacements: prepared.replacements,
      localWorkflowId,
      cascaded: [],
      moved,
      callees,
    };
  }

  /** L'id local d'un workflow de l'instance, connu par son id n8n. */
  private async localIdOf(instanceId: string, externalId: string): Promise<string | undefined> {
    const row = await this.prisma.workflow.findUnique({
      where: { instanceId_externalId: { instanceId, externalId } },
      select: { id: true },
    });
    return row?.id;
  }

  /**
   * Les exemplaires que la promotion va RÉÉCRIRE sur la cible : la cible écrasée, et
   * les détenteurs d'une URL qu'on déplace. Une cible créée n'est verrouillée par personne.
   */
  private async writtenLocalIds(
    instanceId: string,
    prepared: { existing?: { id?: string | number } | null; entryClashes: EntryClash[] },
    input: PromoteInput,
  ): Promise<string[]> {
    const externalIds = [
      ...(prepared.existing?.id !== undefined ? [String(prepared.existing.id)] : []),
      ...(input.moveClashing === false
        ? []
        : prepared.entryClashes.filter((clash) => clash.move !== null).map((clash) => clash.holderId)),
    ];
    const ids = await Promise.all(externalIds.map((externalId) => this.localIdOf(instanceId, externalId)));
    return ids.filter((id): id is string => id !== undefined);
  }

  private async isTargetLocked(
    instanceId: string,
    existing?: { id?: string | number } | null,
  ): Promise<boolean> {
    if (existing?.id === undefined) return false;
    const localId = await this.localIdOf(instanceId, String(existing.id));
    return localId !== undefined && (await this.locks.isLocked(localId));
  }

  /**
   * Publie les appelés en brouillon qui ne démarrent rien seuls, les plus profonds
   * d'abord. Relus dans n8n un par un : c'est `activeVersionId` qui dit s'ils sont
   * publiés, et la cascade vient peut-être d'en créer. Un refus n'arrête pas la
   * promotion — il est rendu, n8n le redira à l'activation.
   */
  private async publishCallees(
    candidate: N8nWorkflow,
    input: PromoteInput,
    targetConfig: Awaited<ReturnType<InstancesService['getConfig']>>,
  ): Promise<NonNullable<PromoteResult['callees']>> {
    const known = new Map<string, N8nWorkflow | undefined>();
    const load = async (id: string): Promise<void> => {
      if (known.has(id)) return;
      const live = await this.n8n.getWorkflow(targetConfig, id).catch(() => undefined);
      known.set(id, live);
      if (live && live.activeVersionId === null) {
        for (const callee of checkedCallees(live)) await load(callee);
      }
    };
    for (const callee of checkedCallees(candidate)) await load(callee);

    const plan = planCalleePublication(candidate, (id) => known.get(id));
    const result: NonNullable<PromoteResult['callees']> = {
      published: [],
      manual: plan.manual.map(({ name, reason }) => ({ name, reason })),
    };
    for (const callee of plan.publish) {
      const localId = await this.localIdOf(input.targetInstanceId, callee.id);
      if (localId && !(await this.locks.canWrite(localId))) {
        result.manual.push({ name: callee.name, reason: 'verrouillé : à publier à la main' });
        continue;
      }
      try {
        await this.n8n.publishWorkflow(targetConfig, callee.id);
        await this.sync.upsertWorkflow(
          input.targetInstanceId,
          await this.n8n.getWorkflow(targetConfig, callee.id),
        );
        result.published.push(callee.name);
        this.logger.log(`Sous-workflow « ${callee.name} » publié avant la promotion`);
      } catch (error) {
        result.manual.push({
          name: callee.name,
          reason: `n8n a refusé de le publier : ${(error as Error).message}`,
        });
      }
    }
    return result;
  }

  /**
   * Pose le path suffixé de son env sur chaque détenteur d'une URL que la cible va
   * servir. Relu dans n8n avant d'écrire : on réécrit le workflow entier. L'uuid n'est
   * pas touché — n8n n'enregistre une URL que par (path, méthode).
   */
  private async moveClashing(
    clashes: EntryClash[],
    input: PromoteInput,
    targetConfig: Awaited<ReturnType<InstancesService['getConfig']>>,
  ): Promise<MovedEntry[]> {
    const moves = clashes.filter((clash) => clash.move !== null);
    const moved: MovedEntry[] = [];
    for (const holderId of new Set(moves.map((clash) => clash.holderId))) {
      const own = moves.filter((clash) => clash.holderId === holderId);
      const live = await this.n8n.getWorkflow(targetConfig, holderId);
      const nodes = live.nodes.map((node) => {
        const clash = own.find((c) => c.holderNode === node.name);
        return clash ? withDeclaredEntryPath(node, clash.move!) : node;
      });
      try {
        await this.n8n.updateWorkflow(targetConfig, holderId, { ...live, nodes });
      } catch (error) {
        throw new BadRequestException(
          `Impossible de libérer l'URL tenue par « ${own[0].holderName} » : ${(error as Error).message}. Rien n'a été promu.`,
        );
      }
      await this.sync.upsertWorkflow(
        input.targetInstanceId,
        await this.n8n.getWorkflow(targetConfig, holderId),
      );
      for (const clash of own) {
        moved.push({
          workflowName: clash.holderName,
          node: clash.holderNode,
          from: clash.url,
          to: clash.move!,
        });
        this.logger.log(`« ${clash.holderName} » / ${clash.holderNode} : /${clash.url} → /${clash.move}`);
      }
    }
    return moved;
  }

  /**
   * Plan de cascade : quels sous-workflows créer sur la cible, et dans quel ordre.
   * Parcours en post-ordre (un appelé avant son appelant), les cycles coupés par
   * les ids déjà vus. Un sous-workflow que la plateforme n'a jamais synchronisé
   * ressort dans `unknown` : on ne sait pas le promouvoir, il reste bloquant.
   */
  private async planCascade(
    sourceInstanceId: string,
    missing: SubWorkflowMapping[],
    targets: TargetWorkflow[],
    targetEnv?: EnvName,
  ): Promise<{ items: CascadeItem[]; unknown: string[] }> {
    const envs = await this.settings.declaredEnvIds();
    // Reconnu au nom métier et à l'env, jamais au numéro de version : un
    // sous-workflow présent sur la cible sous un numéro plus ancien est déjà là.
    const onTarget = new Set(targets.map((target) => envFamilyKey(target.name, envs)));
    const items: CascadeItem[] = [];
    const unknown: string[] = [];
    const seen = new Set<string>();

    const visit = async (externalId: string, label?: string): Promise<void> => {
      if (seen.has(externalId)) return;
      seen.add(externalId);
      const local = await this.prisma.workflow.findFirst({
        where: { instanceId: sourceInstanceId, externalId },
        select: { id: true, name: true, raw: true },
      });
      if (!local) {
        unknown.push(label ?? `workflow n8n #${externalId}`);
        return;
      }
      const targetName = targetEnv ? withEnvSuffix(local.name, targetEnv, envs) : local.name;
      // Déjà sur la cible : rien à créer, et surtout rien à écraser.
      if (onTarget.has(envFamilyKey(targetName, envs))) return;

      for (const ref of extractSubWorkflowRefs(local.raw as unknown as N8nWorkflow)) {
        if (!ref.dynamic) await visit(ref.externalId, ref.label);
      }
      items.push({ workflowId: local.id, sourceName: local.name, targetName });
    };

    for (const mapping of missing) await visit(mapping.sourceN8nId, mapping.sourceName);
    return { items, unknown };
  }

  /**
   * Quality gates. Les credentials sont une heuristique par NOM : l'API n8n ne
   * liste pas les credentials, on regarde donc si un workflow de la cible en
   * référence un du même nom — avertissement, jamais bloquant.
   */
  private async computeGates(
    workflowId: string,
    raw: N8nWorkflow,
    remote: N8nWorkflow[],
    subWorkflows: SubWorkflowMapping[],
    /** Sous-workflows manquants que la cascade ne sait pas créer. */
    uncovered: string[],
    /** Nombre de sous-workflows que la cascade créera. */
    cascade: number,
    /** Nombre de contreparties trouvées sur la cible mais archivées. */
    archived: number,
  ): Promise<Omit<PromoteGates, 'version' | 'chain' | 'remoteSchema'>> {
    const findingErrors = await this.prisma.finding.findMany({
      where: { workflowId, severity: 'error', resolvedAt: null },
      select: { id: true, module: true, code: true, message: true, nodeName: true, data: true },
      orderBy: [{ module: 'asc' }, { code: 'asc' }],
    });

    const cases = await this.prisma.testCase.findMany({
      where: { workflowId, enabled: true },
      select: { lastStatus: true },
    });
    const failed = cases.filter((c) => c.lastStatus === 'failed' || c.lastStatus === 'error').length;
    const passed = cases.filter((c) => c.lastStatus === 'passed').length;
    const neverRun = cases.length - failed - passed;

    const wanted = new Set(
      raw.nodes.flatMap((node) => Object.values(node.credentials ?? {}).map((c) => c.name ?? '')),
    );
    wanted.delete('');
    const seen = new Set(
      remote.flatMap((workflow) =>
        workflow.nodes.flatMap((node) => Object.values(node.credentials ?? {}).map((c) => c.name ?? '')),
      ),
    );
    const missing = [...wanted].filter((name) => !seen.has(name));

    return {
      findings: {
        ok: findingErrors.length === 0,
        errors: findingErrors.length,
        items: findingErrors.slice(0, FINDINGS_PREVIEW_LIMIT).map((finding) => ({
          id: finding.id,
          module: finding.module,
          code: finding.code,
          message: finding.message,
          nodeName: finding.nodeName ?? undefined,
          suggestion: (finding.data as { suggestion?: string } | null)?.suggestion,
        })),
      },
      tests: cases.length === 0 ? null : { ok: failed === 0, total: cases.length, passed, failed, neverRun },
      credentials: { ok: missing.length === 0, missing },
      subWorkflows: {
        ok: uncovered.length === 0 && archived === 0,
        total: subWorkflows.length,
        mapped: subWorkflows.filter((sub) => sub.status === 'mapped').length,
        missing: subWorkflows.filter((sub) => sub.status === 'missing').length,
        dynamic: subWorkflows.filter((sub) => sub.status === 'dynamic').length,
        cascade,
        archived,
      },
    };
  }

  /**
   * Relit le workflow source dans n8n et réaligne le snapshot de la plateforme au
   * passage (nouvelle version `versioning` si le contenu a bougé).
   *
   * Promouvoir depuis la DB revenait à pousser l'état de la dernière synchro : le
   * geste réussissait, la cible recevait une version périmée, et rien dans le
   * résultat ne le disait. Une source injoignable est une erreur franche — pousser
   * un snapshot de repli serait exactement le bug qu'on vient de fermer.
   */
  private async refreshSource(instanceId: string, externalId: string, name: string): Promise<N8nWorkflow> {
    const config = await this.instances.getConfig(instanceId);
    let live: N8nWorkflow;
    try {
      live = await this.n8n.getWorkflow(config, externalId);
    } catch (error) {
      throw new BadRequestException(
        `Impossible de relire « ${name} » dans n8n (${(error as Error).message}) : promotion abandonnée plutôt que de pousser un état périmé.`,
      );
    }
    await this.sync.upsertWorkflow(instanceId, live);
    return live;
  }

  /** Tronc commun preview/apply : candidat basculé + correspondance par nom sur la cible. */
  /**
   * Le candidat est déjà basculé vers l'env cible : ses ids de tables et ses
   * credentials sont ceux de la cible, et c'est sur l'instance cible qu'ils se
   * lisent. Une sonde qui échoue rend la table « non vérifiée », jamais bloquante.
   */
  private async remoteSchemaGate(
    input: PromoteInput,
    targetConfig: N8nInstanceConfig,
    candidate: N8nWorkflow,
  ): Promise<PromoteRemoteSchemaGate | null> {
    if (!input.checkRemote) return null;
    if (!(await this.registry.isEnabled(REMOTE_SCHEMA_MODULE_ID))) return null;
    const report = await this.remoteSchema.check(targetConfig, candidate);
    const missing = report.findings
      .filter((finding) => finding.severity === 'error')
      .map((finding) => ({
        code: finding.code,
        message: finding.message,
        nodeName: finding.nodeName,
        suggestion: typeof finding.data?.suggestion === 'string' ? finding.data.suggestion : undefined,
      }));
    return {
      ok: missing.length === 0,
      missing,
      unverified: report.tables
        .filter((table) => table.status === 'unverified')
        .map((table) => ({ table: table.label ?? table.key, reason: table.reason ?? 'non lue' })),
      tables: report.tables,
    };
  }

  private async prepare(workflowId: string, input: PromoteInput, options: { proposeVersion?: boolean } = {}) {
    const { workflow } = await this.workflows.getRaw(workflowId);
    // La source est relue DANS n8n, jamais reprise au snapshot de la plateforme : une
    // édition faite dans n8n depuis la dernière synchro donnerait sinon une promotion
    // qui réussit en poussant une version périmée — et un preview qui ment sur ce qui part.
    const raw = await this.refreshSource(workflow.instanceId, workflow.externalId, workflow.name);
    const sourceName = raw.name;
    const sourceTags = (raw.tags ?? []).map((tag) => (typeof tag === 'string' ? tag : tag.name));
    // Même instance : c'est le « je repousse ma DEV sur la PROD » — les deux exemplaires
    // cohabitent sous des noms suffixés, c'est le nom qui les apparie comme entre instances.
    const sameInstance = input.targetInstanceId === workflow.instanceId;
    if (sameInstance && !input.targetEnv) {
      throw new BadRequestException(
        'Même instance sans env cible : le workflow s’écraserait lui-même. Choisis l’env vers lequel pousser.',
      );
    }
    const target = await this.prisma.instance.findUniqueOrThrow({
      where: { id: input.targetInstanceId },
    });
    const targetConfig = await this.instances.getConfig(input.targetInstanceId);

    const declaredEnvs = await this.settings.declaredEnvs();
    const envs = envIds(declaredEnvs);
    const mappings = await this.prisma.resourceMapping.findMany();
    const mappingValues = mappings.map((m) => m.values as unknown as MappingValues);
    let candidate = raw;
    let replacements = 0;
    let switched: Array<{ nodeName: string; from: string; to: string }> = [];
    if (input.targetEnv) {
      const outcome = switchResources(
        raw as unknown as N8nWorkflow,
        mappings.map((m) => ({
          values: m.values as unknown as MappingValues,
          labels: (m.labels ?? undefined) as unknown as MappingLabels | undefined,
        })),
        input.targetEnv,
        envs,
      );
      candidate = outcome.workflow as typeof candidate;
      replacements = outcome.replacements;
      switched = outcome.relabeled;
    }
    // Même sans env cible : ces ressources partiront branchées sur les mêmes données.
    const unmapped = findUnmappedResources(raw as unknown as N8nWorkflow, mappingValues);
    const expectedName = input.targetEnv ? withEnvSuffix(sourceName, input.targetEnv, envs) : sourceName;
    if (sameInstance && expectedName === sourceName) {
      throw new BadRequestException(
        `« ${sourceName} » est déjà l’exemplaire ${input.targetEnv} : pousser ici l’écraserait avec lui-même.`,
      );
    }

    // Correspondance live par nom : la DB locale de la cible peut retarder. n8n
    // tolère deux workflows du même nom : l'exemplaire VIVANT prime sur l'archivé,
    // qui est justement celui qu'on a retiré du service.
    const remote = await this.n8n.listWorkflows(targetConfig);
    const existing = findOnTarget(remote, expectedName, envs);
    // Le nom de travail est celui que la cible porte AUJOURD'HUI quand elle existe :
    // c'est sous ce nom qu'on l'écrase, et c'est lui que l'aperçu doit montrer. Le
    // numéro de version, lui, sera reporté dedans au moment d'écrire (`push`) — le
    // prendre ici ferait passer l'écart de numéros entre deux envs pour un renommage.
    const targetName = existing?.name ?? expectedName;

    // Sous-workflows : un id n8n ne vaut que dans son instance. Sans ce remappage, la
    // copie promue rappellerait les sous-workflows de la source (ou échouerait sur
    // « the sub-workflow cannot be called by this workflow »).
    const refs = extractSubWorkflowRefs(candidate as unknown as N8nWorkflow);
    const sourceNames = new Map(
      (
        await this.prisma.workflow.findMany({
          where: { instanceId: workflow.instanceId, externalId: { in: refs.map((ref) => ref.externalId) } },
          select: { externalId: true, name: true },
        })
      ).map((row) => [row.externalId, row.name] as const),
    );
    const subWorkflows = resolveSubWorkflows(refs, {
      sourceNames,
      targets: targetWorkflows(remote),
      targetEnv: input.targetEnv,
      sameInstance,
      envs,
    });
    const remapped = remapSubWorkflowRefs(
      candidate as unknown as N8nWorkflow,
      subWorkflowTargets(subWorkflows),
    );
    candidate = remapped.workflow as typeof candidate;

    // Points d'entrée (webhook, form, chat) : sur une cible existante, c'est SON path
    // qui fait foi — il est déjà en circulation. Un trigger sans contrepartie retombe
    // sur le suffixe d'env, sauf en prod où le path canonique est justement le nu.
    const targetFull =
      existing?.id !== undefined && !existing.nodes?.length
        ? await this.n8n.getWorkflow(targetConfig, String(existing.id))
        : existing;
    const aligned = alignWebhookPaths(candidate as unknown as N8nWorkflow, {
      target: targetFull as N8nWorkflow | undefined,
      env: input.targetEnv,
      envs: declaredEnvs,
      freshId: randomUUID,
    });
    candidate = aligned.workflow as typeof candidate;
    // Une URL que la cible va poser peut déjà être tenue sur l'instance par un autre
    // workflow — la source elle-même quand dev et prod y cohabitent. L'archivé ne sert
    // rien ; la cible qu'on écrase non plus, puisqu'on la remplace.
    const remoteById = new Map(remote.map((w) => [String(w.id), w as unknown as N8nWorkflow]));
    const callees = planCalleePublication(candidate as unknown as N8nWorkflow, (id) => remoteById.get(id));
    const entryClashes = findEntryClashes(
      candidate as unknown as N8nWorkflow,
      remote
        .filter((w) => !w.isArchived && (existing?.id === undefined || String(w.id) !== String(existing.id)))
        .map((w) => ({
          id: String(w.id),
          name: w.name,
          active: w.active === true,
          env: detectWorkflowEnv(
            w.name,
            (w.tags ?? []).map((tag) => (typeof tag === 'string' ? tag : tag.name)),
            envs,
          ),
          raw: w as unknown as N8nWorkflow,
        })),
      declaredEnvs,
    );
    // Une ressource que la cible vise déjà garde l'écriture de la cible : un id tapé
    // en dev ne doit pas remplacer, en preprod, le choix de liste et son nom lisible.
    candidate = adoptTargetLocators(
      candidate as unknown as N8nWorkflow,
      targetFull as N8nWorkflow | undefined,
    ).workflow as typeof candidate;

    // Sous-workflows absents de la cible : soit la cascade les crée, soit ils bloquent
    // (promouvoir un appelant vers une instance où l'appelé n'existe pas ne peut que casser).
    const missing = subWorkflows.filter((sub) => sub.status === 'missing');
    const plan =
      input.cascade && missing.length > 0
        ? await this.planCascade(workflow.instanceId, missing, targetWorkflows(remote), input.targetEnv)
        : { items: [], unknown: [] };
    const uncovered = input.cascade
      ? plan.unknown
      : missing.map((sub) => sub.targetName ?? sub.sourceName ?? sub.sourceN8nId);

    // Contrepartie archivée sur la cible : n8n la garde visible dans l'API, mais
    // refuse toute écriture dessus (« Cannot update an archived workflow ») et ne
    // l'exécute plus. Un sous-workflow archivé se rattache donc à un appelé mort.
    const archivedSubs = subWorkflows.filter((sub) => sub.targetArchived);

    const baseGates = await this.computeGates(
      workflow.id,
      raw as unknown as N8nWorkflow,
      remote,
      subWorkflows,
      uncovered,
      plan.items.length,
      archivedSubs.length,
    );

    const diff = existing
      ? diffWorkflows(
          existing,
          { ...(candidate as unknown as N8nWorkflow), name: targetName },
          // Même ressource écrite autrement (liste ou id, `=id`, nom affiché) : pas un changement.
          { compareAs: canonicalLocatorNode },
        )
      : undefined;
    const exemplars = await this.familyExemplars(sourceName);
    const chainGate = await this.chainGate(input, {
      sourceName,
      sourceTags,
      targetName,
      targetInstanceName: target.name,
      existing,
      exemplars,
    });
    const versionGate = await this.versionGate(input, options, {
      diff,
      workflowId,
      sourceRaw: raw as unknown as N8nWorkflow,
      sourceName,
      sourceVersion: workflow.version ?? versionFromName(sourceName, envs),
      targetEnv: chainGate.to,
      targetName,
      targetInstanceId: input.targetInstanceId,
      exemplars,
    });
    const remoteSchemaGate = await this.remoteSchemaGate(
      input,
      targetConfig,
      candidate as unknown as N8nWorkflow,
    );
    const gates: PromoteGates = {
      ...baseGates,
      version: versionGate,
      chain: chainGate,
      remoteSchema: remoteSchemaGate,
    };

    // Le refus de chaîne se tient à l'écart des autres : `force` ne l'ouvre pas, et
    // il ne doit pas non plus faire échouer les étapes internes d'une traversée.
    const chainBlocker = chainSkipRefusal(chainGate, input);
    const needsSkipConfirm = chainGate.mode === 'warn' && !chainGate.ok && !input.confirmSkip;

    const hardBlockers: string[] = [];
    if (existing?.isArchived) {
      hardBlockers.push(
        `« ${targetName} » existe sur ${target.name} mais y est ARCHIVÉ : n8n refuse toute modification d'un workflow archivé. Désarchive-le dans n8n (ou renomme-le) avant de promouvoir.`,
      );
    }
    const blockers: string[] = [...hardBlockers];
    if (!gates.findings.ok) blockers.push(`${gates.findings.errors} finding(s) de sévérité error`);
    if (gates.tests && !gates.tests.ok) blockers.push(`${gates.tests.failed} test(s) en échec`);
    if (archivedSubs.length > 0) {
      blockers.push(
        `${archivedSubs.length} sous-workflow(s) archivé(s) sur la cible : ${archivedSubs
          .map((sub) => sub.targetName ?? sub.sourceName ?? sub.sourceN8nId)
          .join(', ')} — désarchive-les dans n8n, un archivé ne s'exécute plus`,
      );
    }
    if (uncovered.length > 0) {
      blockers.push(
        input.cascade
          ? `${uncovered.length} sous-workflow(s) inconnu(s) de la plateforme (resynchronise l'instance source) : ${uncovered.join(', ')}`
          : `${uncovered.length} sous-workflow(s) sans contrepartie sur la cible : ${uncovered.join(', ')}`,
      );
    }
    if (gates.remoteSchema && !gates.remoteSchema.ok) blockers.push(remoteSchemaBlocker(gates.remoteSchema));
    for (const clash of entryClashes) {
      if (!clash.holderActive || (clash.move !== null && input.moveClashing !== false)) continue;
      blockers.push(
        `« ${clash.node} » : /${clash.url} est déjà servi par « ${clash.holderName} » (actif)` +
          (clash.move
            ? ` — coche « libérer l'URL » pour le passer en /${clash.move}`
            : " — libère l'URL dans n8n"),
      );
    }
    if (!gates.version.ok) {
      blockers.push(
        `la cible porte ${gates.version.targetVersion} et la source ${gates.version.sourceVersion ?? 'aucune version'} : ` +
          "la cible a reçu quelque chose que la source n'a pas — vérifie que tu n'écrases pas un correctif fait directement là-bas",
      );
    }

    return {
      gates,
      blockers,
      hardBlockers,
      chainBlocker,
      needsSkipConfirm,
      diff,
      sourceName,
      sourceTags,
      targetInstanceName: target.name,
      targetConfig,
      targetName,
      candidate,
      replacements,
      switched,
      unmapped,
      subWorkflows,
      cascade: plan.items,
      existing,
      webhookPaths: { preserved: aligned.preserved, changes: aligned.changes },
      entryClashes,
      callees,
    };
  }

  /**
   * Les exemplaires connus du même workflow métier, tous envs et toutes instances.
   * La recherche part du nom sans son suffixe d'env, puis la clé de famille tranche :
   * c'est le nom qui apparie les exemplaires, ici comme à la promotion.
   */
  private async familyExemplars(sourceName: string): Promise<KnownExemplar[]> {
    const envs = await this.settings.declaredEnvIds();
    const key = workflowFamilyKey(sourceName, envs);
    const rows = await this.prisma.workflow.findMany({
      where: { name: { contains: workflowFamilyName(sourceName, envs), mode: 'insensitive' } },
      select: {
        name: true,
        tags: true,
        version: true,
        instanceId: true,
        instance: { select: { name: true } },
      },
    });
    return rows
      .filter((row) => workflowFamilyKey(row.name, envs) === key)
      .map((row) => ({
        env: detectWorkflowEnv(row.name, row.tags, envs),
        instanceId: row.instanceId,
        instanceName: row.instance.name,
        // Le numéro tenu dans le NOM vaut version tant que la colonne est vide :
        // sans lui, un workflow que l'équipe appelle déjà 1.2.1 se voyait proposer
        // 1.0.0, et la promotion posait un numéro que n8n contredisait.
        version: row.version ?? versionFromName(row.name, envs),
        name: row.name,
      }));
  }

  /**
   * Ce que la chaîne déclarée dit du chemin source → cible. L'env de la cible vient
   * de `targetEnv` quand il est choisi ; sinon on lit celui de l'exemplaire d'en
   * face — une instance dont les workflows portent `env:prod` se situe toute seule,
   * et à défaut le chemin reste `unknown` : on ne reproche pas de sauter une étape
   * qu'on est incapable de placer.
   */
  private async chainGate(
    input: PromoteInput,
    context: {
      sourceName: string;
      sourceTags: string[];
      targetName: string;
      targetInstanceName: string;
      existing?: N8nWorkflow;
      exemplars: KnownExemplar[];
    },
  ): Promise<PromoteChainGate> {
    const { envs, envChainMode } = await this.settings.get();
    const ids = envIds(envs);
    const from = detectWorkflowEnv(context.sourceName, context.sourceTags, ids);
    const to =
      input.targetEnv ??
      (context.existing
        ? detectWorkflowEnv(
            context.existing.name ?? context.targetName,
            (context.existing.tags ?? []).map((tag) => (typeof tag === 'string' ? tag : tag.name)),
            ids,
          )
        : null);
    const plan = envChainPlan(envs, from, to);
    const steps = resolveChainSteps(plan.skipped, context.exemplars, {
      instanceId: input.targetInstanceId,
      instanceName: context.targetInstanceName,
    });
    const through = Boolean(input.throughChain) && steps.length > 0;
    return {
      ok: plan.skipped.length === 0 || through,
      mode: envChainMode,
      // La LIGNÉE de la cible, pas la liste des envs : avec des branches, une
      // suite à plat ferait passer la recette d'un autre client pour une étape.
      chain: envLineage(envs, to),
      from,
      to,
      direction: plan.direction,
      skipped: plan.skipped,
      steps,
      through,
    };
  }

  /** Numéro courant de chaque exemplaire, et celui que la promotion posera. */
  private async versionGate(
    input: PromoteInput,
    options: { proposeVersion?: boolean },
    context: {
      diff?: WorkflowDiff;
      workflowId: string;
      /** La source telle qu'elle est DANS n8n : c'est elle qu'on compare à sa release. */
      sourceRaw: N8nWorkflow;
      sourceName: string;
      sourceVersion: string | null;
      targetEnv: EnvName | null;
      targetName: string;
      targetInstanceId: string;
      exemplars: KnownExemplar[];
    },
  ): Promise<PromoteVersionGate> {
    // La reprise passe avant tout le reste, y compris l'appel à l'IA : une source
    // qui n'a pas bougé depuis sa mise en service n'a rien de neuf à publier, et
    // le seul geste juste est de reporter son numéro. C'est le cas de la seconde
    // étape d'un chemin (« dev → preprod » hier, « preprod → prod » aujourd'hui),
    // où incrémenter faisait porter deux numéros à un même contenu.
    const release = await this.release.of(context.workflowId, context.sourceRaw);
    const reprise =
      release.state === 'clean' && release.version
        ? {
            level: 'none' as const,
            reason: `« ${context.sourceName} » n'a pas bougé depuis sa mise en service en ${release.version} : la promotion reporte ce numéro, elle ne publie rien de neuf.`,
            source: 'rules' as const,
          }
        : null;
    const proposal: { level: ReleaseLevel; reason: string; source: 'ai' | 'rules' | 'human' } = input.bump
      ? {
          level: input.bump,
          reason:
            input.bump === 'none'
              ? 'Reprise choisie à la main : le numéro de la source est reporté tel quel.'
              : 'Niveau choisi à la main.',
          source: 'human',
        }
      : (reprise ??
        (await this.versions.propose(
          context.diff,
          { name: context.sourceName, targetEnv: context.targetEnv ?? undefined },
          Boolean(options.proposeVersion),
        )));

    // L'exemplaire d'en face se reconnaît au nom métier et à l'env, pas au numéro :
    // c'est justement quand les deux numéros diffèrent qu'on a besoin de le lire.
    const envs = await this.settings.declaredEnvIds();
    const target = context.exemplars.find(
      (exemplar) =>
        envFamilyKey(exemplar.name, envs) === envFamilyKey(context.targetName, envs) &&
        exemplar.instanceId === context.targetInstanceId,
    );
    const source = parseSemver(context.sourceVersion);
    const ahead = parseSemver(target?.version);
    // Le maximum du workflow métier, pas celui de la source : un numéro déjà servi
    // à un autre env ne doit jamais être rejoué.
    // Reprise : le numéro de la source, pas le maximum de la famille — un env resté
    // en avance ne doit pas tirer vers le haut un contenu qui, lui, n'a pas changé.
    const next =
      proposal.level === 'none'
        ? (release.version ?? context.sourceVersion ?? INITIAL_VERSION)
        : nextVersion(
            context.exemplars.map((exemplar) => exemplar.version),
            proposal.level,
          );
    const nextName = renameWithVersion(context.targetName, next, envs);
    return {
      // La cible en avance sur la source n'est pas une erreur de calcul : c'est le
      // signe qu'on a corrigé quelque chose directement là-bas, et que la promotion
      // s'apprête à l'écraser. C'est la seule chose que le numéro sache dire.
      ok: !(source && ahead && compareSemver(ahead, source) > 0),
      current: context.exemplars.map((exemplar) => ({
        env: exemplar.env,
        instanceName: exemplar.instanceName,
        name: exemplar.name,
        version: exemplar.version,
      })),
      sourceVersion: context.sourceVersion,
      targetVersion: target?.version ?? null,
      next,
      nextName: nextName === context.targetName ? null : nextName,
      level: proposal.level,
      reason: proposal.reason,
      source: proposal.source,
    };
  }
}

/**
 * L'exemplaire de la cible, cherché par nom — puis, à défaut, par nom SANS son
 * numéro de version, à env égal.
 *
 * C'est le rattrapage qui compte : le numéro vit dans le nom et il bouge d'un env
 * à l'autre, si bien qu'une dev en « X (1.2.1) » ne reconnaissait plus sa prod en
 * « X (1.1.4) » et créait un second workflow inactif à côté de celui qui tourne.
 * Le nom exact reste prioritaire ; à plusieurs candidats, le vivant prime sur
 * l'archivé, puis le plus haut numéro — c'est celui que la prod sert.
 */
export function findOnTarget(
  remote: N8nWorkflow[],
  targetName: string,
  envs?: readonly string[],
): N8nWorkflow | undefined {
  const exact = remote.filter((w) => w.name === targetName);
  const key = envFamilyKey(targetName, envs);
  const candidates = exact.length > 0 ? exact : remote.filter((w) => envFamilyKey(w.name, envs) === key);
  return [...candidates].sort((a, b) => {
    const archived = Number(a.isArchived === true) - Number(b.isArchived === true);
    if (archived !== 0) return archived;
    const left = parseSemver(versionFromName(a.name, envs));
    const right = parseSemver(versionFromName(b.name, envs));
    if (left && right) return compareSemver(right, left);
    return 0;
  })[0];
}

/**
 * Le refus opposé à une promotion qui saute une étape déclarée. Null quand rien
 * n'est sauté, quand la traversée est demandée, ou quand un humain a confirmé le
 * saut en mode `warn`. En mode `block`, rien ne l'ouvre — c'est le sens du mode.
 */
function chainSkipRefusal(gate: PromoteChainGate, input: PromoteInput): string | null {
  if (gate.ok) return null;
  const skipped = gate.skipped.map((env) => env.toUpperCase()).join(', ');
  const route = [gate.from, ...gate.skipped, gate.to].filter(Boolean).join(' → ');
  if (gate.mode === 'block') {
    return (
      `La chaîne d'environnements est en mode bloquant et cette promotion saute ${skipped} : ` +
      `passe par ${route}, ou coche « passer par les envs intermédiaires ».`
    );
  }
  if (input.confirmSkip) return null;
  return (
    `Cette promotion saute ${skipped} (chaîne déclarée : ${gate.chain.map((env) => env.toUpperCase()).join(' → ')}). ` +
    'Confirme le saut explicitement, ou fais-la passer par les envs intermédiaires.'
  );
}

function remoteSchemaBlocker(gate: PromoteRemoteSchemaGate): string {
  const nodes = [...new Set(gate.missing.map((item) => item.nodeName).filter(Boolean))];
  return `${gate.missing.length} colonne(s) ou table(s) absente(s) sur la cible (${nodes.join(', ')}) — crée-les avant de promouvoir`;
}
