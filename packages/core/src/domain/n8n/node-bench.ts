/**
 * Banc d'essai d'un nœud : un workflow autonome qui n'exécute QUE le nœud
 * visé, alimenté par des données figées, déclenchable par webhook.
 *
 * Deux contraintes de n8n décident de la forme :
 *   - `pinData` n'est honoré que dans les exécutions manuelles de l'éditeur —
 *     un banc piloté par l'API doit donc porter sa donnée dans de VRAIS nœuds ;
 *   - `$('X')` ne résout que si X a tourné dans la MÊME exécution — les nœuds
 *     référencés par les expressions doivent donc exister, sous leur nom exact,
 *     et se trouver en amont sur le chemin exécuté.
 *
 * D'où la forme : Webhook → un nœud Code par nœud à simuler (chaînés) → le nœud
 * testé (recopié tel quel, credentials compris) → Respond to Webhook.
 */
import { randomUUID } from 'crypto';
import { EnvName } from '../env';
import { N8nConnections, N8nNode, N8nWorkflow } from './workflow.types';
import { activeParameters } from './inert-params';
import { paramLabel, paramString } from './n8n-params';
import { extractNodeRefs } from './expression-refs';
import { readRunData } from './execution-samples';
import { isStickyNote, isTriggerNode } from './workflow-graph';
import { SideEffectKind, classifySideEffect } from './side-effect-nodes';
import { gateEnv } from './proposal-gate';

export const BENCH_PREFIX = '[BANC]';
/** Tag posé sur le banc : c'est lui qui le sort des listes et des analyses. */
export const BENCH_TAG = 'n8n-ops:banc-essai';
/** Nœud d'entrée quand le nœud testé n'a aucun parent dans le workflow d'origine. */
export const BENCH_INPUT_NAME = 'Entrée du banc';

/** Nom du banc — c'est lui qui sert de clé de réutilisation, comme pour les bouchons. */
export function benchWorkflowName(workflowName: string, nodeName: string): string {
  return `${BENCH_PREFIX} ${workflowName} · ${nodeName}`;
}

export function isBenchWorkflow(workflow: { name: string }): boolean {
  return workflow.name.startsWith(BENCH_PREFIX);
}

/** Pourquoi ce nœud doit être simulé : il alimente l'entrée, il est cité par une expression, ou les deux. */
export type BenchFeedRole = 'input' | 'expression' | 'both';

export interface BenchFeed {
  /** Nom EXACT du nœud d'origine : `$('...')` ne résout que sous ce nom-là. */
  nodeName: string;
  role: BenchFeedRole;
  /** Index d'entrée du nœud testé qu'il alimente (`role` input/both uniquement). */
  inputIndex?: number;
  /** Type de connexion d'origine (`main`, sauf montage exotique). */
  inputType?: string;
  /** Chemins des paramètres qui le citent, pour dire à l'écran d'où vient la demande. */
  citedAt: string[];
}

export type BenchIssueCode =
  'sticky-note' | 'trigger-node' | 'sub-nodes-run' | 'binary-input' | 'missing-ref' | 'node-disabled';

export interface BenchIssue {
  code: BenchIssueCode;
  severity: 'blocking' | 'warning' | 'info';
  message: string;
}

export interface NodeBenchPlan {
  nodeName: string;
  type: string;
  /** Nœuds à alimenter, dans l'ordre où le banc les chaînera. */
  feeds: BenchFeed[];
  /**
   * Sous-nœuds recopiés tels quels (modèle de langage, embeddings, outils) :
   * un Code ne peut pas s'y substituer. Ils s'exécutent donc POUR DE VRAI.
   */
  subNodes: string[];
  issues: BenchIssue[];
  /** Un banc ne peut pas être construit : la raison est dans `issues`. */
  blocked: boolean;
}

interface InputEdge {
  from: string;
  type: string;
  inputIndex: number;
}

/** Connexions ENTRANTES d'un nœud, index d'entrée compris (que `WorkflowGraph` n'expose pas). */
function inputEdges(workflow: N8nWorkflow, nodeName: string): InputEdge[] {
  const edges: InputEdge[] = [];
  for (const [from, byType] of Object.entries(workflow.connections ?? {})) {
    for (const [type, outputs] of Object.entries(byType ?? {})) {
      for (const targets of outputs ?? []) {
        for (const target of targets ?? []) {
          if (target?.node === nodeName) edges.push({ from, type, inputIndex: target.index ?? 0 });
        }
      }
    }
  }
  return edges;
}

/**
 * Sous-nœuds attachés (transitivement) : tout parent branché par autre chose
 * que `main` — le Chat Model d'un Agent, les Embeddings d'un Vector Store.
 */
function collectSubNodes(workflow: N8nWorkflow, nodeName: string): string[] {
  const found: string[] = [];
  const seen = new Set([nodeName]);
  const stack = [nodeName];
  while (stack.length) {
    const current = stack.pop()!;
    for (const edge of inputEdges(workflow, current)) {
      if (edge.type === 'main' || seen.has(edge.from)) continue;
      seen.add(edge.from);
      found.push(edge.from);
      stack.push(edge.from);
    }
  }
  return found;
}

/** Le binaire ne se reconstitue pas depuis un échantillon JSON : mieux vaut le dire que le laisser échouer. */
function needsBinaryInput(node: N8nNode): boolean {
  const serialized = JSON.stringify(activeParameters(node));
  if (serialized.includes('$binary')) return true;
  return /"(binaryPropertyName|inputDataFieldName|binaryPropertyNameDownload)"\s*:\s*"[^"]+"/.test(
    serialized,
  );
}

/**
 * Ce qu'un banc devrait contenir pour ce nœud : qui l'alimente, qui ses
 * expressions réclament, et ce qui empêche ou abîme l'essai.
 */
export function planNodeBench(workflow: N8nWorkflow, nodeName: string): NodeBenchPlan {
  const node = workflow.nodes.find((n) => n.name === nodeName);
  if (!node) throw new Error(`Nœud « ${nodeName} » absent du workflow`);

  const issues: BenchIssue[] = [];
  const names = new Set(workflow.nodes.map((n) => n.name));

  if (isStickyNote(node)) {
    issues.push({ code: 'sticky-note', severity: 'blocking', message: 'Une note n’exécute rien.' });
  }
  if (isTriggerNode(node)) {
    issues.push({
      code: 'trigger-node',
      severity: 'blocking',
      message: 'Un déclencheur produit l’entrée : il n’y a rien à alimenter ni à isoler.',
    });
  }
  if (node.disabled) {
    issues.push({
      code: 'node-disabled',
      severity: 'info',
      message: 'Nœud désactivé dans le workflow d’origine : le banc l’exécute quand même.',
    });
  }
  if (needsBinaryInput(node)) {
    issues.push({
      code: 'binary-input',
      severity: 'warning',
      message: 'Ce nœud attend un fichier en entrée : un échantillon JSON ne le reconstitue pas.',
    });
  }

  // Refs d'expressions : sur les paramètres ACTIFS, sinon on bâtirait un banc
  // pour du paramètre mort (mapping resté sous « Map Automatically »…).
  const cited = new Map<string, string[]>();
  for (const { path, ref } of extractNodeRefs(activeParameters(node), '$.parameters')) {
    if (ref === nodeName) continue;
    if (!cited.has(ref)) cited.set(ref, []);
    cited.get(ref)!.push(path);
  }
  for (const ref of cited.keys()) {
    if (names.has(ref)) continue;
    issues.push({
      code: 'missing-ref',
      severity: 'warning',
      message: `L’expression cite « ${ref} », qui n’existe pas dans le workflow : le banc l’ajoutera sous ce nom.`,
    });
  }

  const mainEdges = inputEdges(workflow, nodeName).filter((e) => e.type === 'main' && names.has(e.from));
  const feeds = new Map<string, BenchFeed>();

  // Les citations d'abord : elles doivent avoir tourné avant, mais ce n'est pas
  // par elles que passe l'entrée du nœud.
  for (const [ref, citedAt] of cited) {
    feeds.set(ref, { nodeName: ref, role: 'expression', citedAt });
  }
  const inputFeeds: InputEdge[] = mainEdges.length
    ? mainEdges
    : [{ from: BENCH_INPUT_NAME, type: 'main', inputIndex: 0 }];
  for (const edge of inputFeeds) {
    const existing = feeds.get(edge.from);
    feeds.delete(edge.from);
    feeds.set(edge.from, {
      nodeName: edge.from,
      role: existing ? 'both' : 'input',
      inputIndex: edge.inputIndex,
      inputType: edge.type,
      citedAt: existing?.citedAt ?? [],
    });
  }

  const subNodes = collectSubNodes(workflow, nodeName);
  if (subNodes.length) {
    issues.push({
      code: 'sub-nodes-run',
      severity: 'warning',
      message: `Sous-nœuds recopiés et RÉELLEMENT exécutés : ${subNodes.join(', ')}.`,
    });
  }

  return {
    nodeName,
    type: node.type,
    feeds: [...feeds.values()],
    subNodes,
    issues,
    blocked: issues.some((i) => i.severity === 'blocking'),
  };
}

export interface NodeBenchOptions {
  workflow: N8nWorkflow;
  nodeName: string;
  /** Chemin du webhook de déclenchement (unique par banc). */
  webhookPath: string;
  /** Items servis par nœud simulé, dans la forme brute d'un `json` n8n. */
  feeds: Record<string, unknown[]>;
  /** Identifiants stables (tests) — défaut : `randomUUID()`. */
  newId?: () => string;
}

/** Nœud Code qui rend exactement les items fournis, quoi qu'il reçoive. */
function feedNode(feed: BenchFeed, items: unknown[], position: [number, number], id: string): N8nNode {
  return {
    id,
    name: feed.nodeName,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `// Données figées par le banc d'essai.\nreturn ${JSON.stringify(
        items.map((json) => ({ json })),
        null,
        2,
      )};`,
    },
    notes:
      feed.role === 'expression'
        ? 'Simulé : cité par une expression du nœud testé.'
        : 'Simulé : alimente l’entrée du nœud testé.',
    notesInFlow: true,
  };
}

function link(
  connections: N8nConnections,
  from: string,
  to: string,
  type = 'main',
  inputIndex = 0,
  outputIndex = 0,
): void {
  const byType = (connections[from] ??= {});
  const outputs = (byType[type] ??= []);
  while (outputs.length <= outputIndex) outputs.push([]);
  outputs[outputIndex].push({ node: to, type, index: inputIndex });
}

/**
 * Le banc lui-même. Le nœud testé est recopié TEL QUEL — paramètres complets
 * (pas `activeParameters` : on écrit un workflow, pas une analyse) et
 * credentials d'origine, puisque c'est justement son vrai comportement qu'on
 * veut voir. D'où l'écran d'impact avant lancement : ici, rien n'est bouchonné.
 */
export function buildNodeBenchWorkflow(options: NodeBenchOptions): N8nWorkflow {
  const { workflow, nodeName, webhookPath, feeds } = options;
  const newId = options.newId ?? randomUUID;
  const plan = planNodeBench(workflow, nodeName);
  if (plan.blocked) {
    throw new Error(
      `Banc impossible pour « ${nodeName} » : ${plan.issues[0]?.message ?? 'nœud non testable'}`,
    );
  }

  const source = workflow.nodes.find((n) => n.name === nodeName)!;
  const nodes: N8nNode[] = [
    {
      id: newId(),
      name: 'Lancer le banc',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      webhookId: newId(),
      position: [0, 0],
      parameters: { httpMethod: 'POST', path: webhookPath, responseMode: 'responseNode', options: {} },
      notes: `Banc d'essai du nœud « ${nodeName} » (workflow « ${workflow.name} »). Posé par la plateforme.`,
      notesInFlow: true,
    },
  ];
  const connections: N8nConnections = {};

  // Chaînage : chaque simulé passe la main au suivant, pour que TOUS aient
  // tourné quand le nœud testé résout ses `$('...')`.
  let previous = 'Lancer le banc';
  plan.feeds.forEach((feed, index) => {
    nodes.push(feedNode(feed, feeds[feed.nodeName] ?? [{}], [220 * (index + 1), 0], newId()));
    link(connections, previous, feed.nodeName);
    previous = feed.nodeName;
  });

  const testedX = 220 * (plan.feeds.length + 1);
  nodes.push({
    ...source,
    id: newId(),
    disabled: false,
    position: [testedX, 0],
    // Un plantage doit revenir lisible : sans cela, le webhook ne rend qu'un
    // « Workflow execution failed » muet et l'essai n'apprend rien.
    onError: 'continueRegularOutput',
    alwaysOutputData: true,
  });
  for (const feed of plan.feeds) {
    if (feed.role === 'expression') continue;
    link(connections, feed.nodeName, nodeName, feed.inputType ?? 'main', feed.inputIndex ?? 0);
  }

  // Sous-nœuds (modèle de langage, embeddings, outils) : recopiés avec leur
  // branchement d'origine — aucun Code ne peut en tenir lieu.
  plan.subNodes.forEach((name, index) => {
    const sub = workflow.nodes.find((n) => n.name === name);
    if (!sub) return;
    nodes.push({ ...sub, id: newId(), position: [testedX + 220 * index, 220] });
    for (const [type, outputs] of Object.entries(workflow.connections?.[name] ?? {})) {
      (outputs ?? []).forEach((targets, outputIndex) => {
        for (const target of targets ?? []) {
          if (nodes.some((n) => n.name === target.node)) {
            link(connections, name, target.node, type, target.index ?? 0, outputIndex);
          }
        }
      });
    }
  });

  nodes.push({
    id: newId(),
    name: 'Rendre le résultat',
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.1,
    position: [testedX + 220, 0],
    parameters: { respondWith: 'allIncomingItems', options: {} },
  });
  link(connections, nodeName, 'Rendre le résultat');

  // `errorWorkflow` retiré : un essai ne doit alerter personne.
  const settings = { ...(workflow.settings ?? {}) };
  delete settings.errorWorkflow;

  return {
    name: benchWorkflowName(workflow.name, nodeName),
    active: false,
    nodes,
    connections,
    settings,
    // L'écriture publique ignore `tags` : c'est `setWorkflowTags` qui le pose
    // vraiment. Il est ici pour que le banc dise ce qu'il est, hors de n8n aussi.
    tags: [{ name: BENCH_TAG }],
  };
}

/**
 * Ce que le nœud VISE, dit en clair : c'est ce qui manque le plus avant de
 * lancer. « appel HTTP POST » ne dit pas si l'on tape le CRM de production ;
 * `POST https://crm.exemple.fr/leads`, si.
 */
export function describeNodeTarget(node: N8nNode): string | undefined {
  const parameters = activeParameters(node);
  const url = paramString(parameters['url']);
  if (url) return `${(paramString(parameters['method']) ?? 'GET').toUpperCase()} ${url}`;

  const operation = paramString(parameters['operation']);
  const resource = paramString(parameters['resource']);
  // Le libellé n8n (`cachedResultName`) nomme la base ou la table visée ; à
  // défaut l'id brut, qui reste plus parlant que rien.
  const target = ['base', 'table', 'documentId', 'sheetName', 'databaseId', 'channel', 'chatId']
    .map((key) => paramLabel(parameters[key]) ?? paramString(parameters[key]))
    .find((value) => value !== undefined);

  const parts = [resource, operation].filter(Boolean).join(' · ');
  if (!parts && !target) return undefined;
  return [parts, target].filter(Boolean).join(' → ');
}

export interface BenchImpact {
  nodeName: string;
  /** `undefined` = ce nœud ne sort rien du système (il lit, il transforme). */
  kind?: SideEffectKind;
  /** Ce qu'il fait : « poste un message », « écrit des données (create) ». */
  reason: string;
  /** Ce qu'il vise, quand le JSON le dit. */
  target?: string;
  /** Credentials qu'il emploie — le banc les garde, ce sont les vrais. */
  credentials: string[];
  /** Sous-nœud recopié plutôt que nœud testé (un modèle de langage, typiquement). */
  subNode: boolean;
}

function impactOf(node: N8nNode, subNode: boolean): BenchImpact {
  const verdict = classifySideEffect(node);
  return {
    nodeName: node.name,
    kind: verdict?.kind,
    reason: verdict?.reason ?? 'lit ou transforme, sans rien sortir du système',
    target: describeNodeTarget(node),
    credentials: Object.values(node.credentials ?? {})
      .map((credential) => credential?.name)
      .filter((name): name is string => !!name),
    subNode,
  };
}

/**
 * Tout ce qui s'exécutera vraiment : le nœud testé et les sous-nœuds recopiés.
 * Les simulés n'y sont pas — ce sont des Code qui rendent une constante.
 */
export function benchImpacts(workflow: N8nWorkflow, plan: NodeBenchPlan): BenchImpact[] {
  const byName = new Map(workflow.nodes.map((node) => [node.name, node]));
  const tested = byName.get(plan.nodeName);
  const impacts = tested ? [impactOf(tested, false)] : [];
  for (const name of plan.subNodes) {
    const sub = byName.get(name);
    if (sub) impacts.push(impactOf(sub, true));
  }
  return impacts;
}

export interface BenchGateVerdict {
  blocked: boolean;
  /** Ce qui bloque, ou ce qui passe malgré tout — repris tel quel à l'écran. */
  reasons: string[];
}

/**
 * La porte du banc. Rien n'est bouchonné ici : un nœud qui sort du système
 * sortira pour de vrai. On applique donc la règle des propositions IA — en dev
 * on montre et on laisse passer, en prod on arrête, sauf `force` coché par un
 * humain. Un workflow sans env déclaré mais ACTIF compte comme de la prod.
 */
export function evaluateBenchGate(
  impacts: BenchImpact[],
  options: { env: EnvName | null; active: boolean; force?: boolean },
): BenchGateVerdict {
  const sortants = impacts.filter((impact) => impact.kind);
  if (sortants.length === 0) return { blocked: false, reasons: [] };

  const reasons = sortants.map(
    (impact) => `${impact.nodeName} ${impact.reason}${impact.target ? ` (${impact.target})` : ''}`,
  );
  if (gateEnv(options.env, options.active) === 'safe') return { blocked: false, reasons };
  if (options.force) {
    return { blocked: false, reasons: [...reasons, 'Contournement explicite : lancé malgré la production.'] };
  }
  return {
    blocked: true,
    reasons: [
      ...reasons,
      'Workflow de production : bascule les ressources sur un env de dev, ou coche le contournement.',
    ],
  };
}

export interface BenchOutcome {
  /** `unknown` : le nœud n'a pas tourné — ni sortie ni erreur à lui attribuer. */
  status: 'ok' | 'failed' | 'unknown';
  items: Array<Record<string, unknown>>;
  error?: string;
}

function errorMessage(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const message = record.message ?? record.description ?? record.reason;
    if (typeof message === 'string' && message.length > 0) return message;
    return JSON.stringify(value).slice(0, 500);
  }
  return undefined;
}

/**
 * Ce que le banc a produit, lu dans l'EXÉCUTION et non dans la réponse HTTP.
 *
 * Le nœud testé porte `onError: continueRegularOutput` — sans quoi le webhook
 * ne rendrait qu'un « Workflow execution failed » muet. Le prix à payer est
 * ici : n8n range alors l'échec dans un item de sortie ordinaire, et une lecture
 * naïve rendrait « ok » pour un nœud qui a planté. On regarde donc l'erreur du
 * run, puis celle portée par les items, avant de conclure au succès.
 */
export function readBenchOutcome(execution: { data?: unknown }, nodeName: string): BenchOutcome {
  const runs = readRunData(execution)?.[nodeName];
  if (!Array.isArray(runs) || runs.length === 0) {
    const failure = errorMessage(asRecord(asRecord(parseExecutionData(execution))?.resultData)?.error);
    return failure
      ? { status: 'failed', items: [], error: failure }
      : { status: 'unknown', items: [], error: 'Le nœud n’a pas été exécuté par le banc.' };
  }

  const items: Array<Record<string, unknown>> = [];
  let error: string | undefined;
  for (const run of runs) {
    const record = asRecord(run);
    error ??= errorMessage(record?.error);
    const main = asRecord(record?.data)?.main;
    if (!Array.isArray(main)) continue;
    for (const output of main) {
      if (!Array.isArray(output)) continue;
      for (const item of output) {
        const json = asRecord(asRecord(item)?.json);
        if (!json) continue;
        items.push(json);
        // `continueRegularOutput` : l'échec descend dans l'item, pas dans le run.
        error ??= errorMessage(json.error);
      }
    }
  }

  if (error) return { status: 'failed', items, error };
  return { status: 'ok', items };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseExecutionData(execution: { data?: unknown }): Record<string, unknown> | undefined {
  if (typeof execution.data === 'string') {
    try {
      return asRecord(JSON.parse(execution.data));
    } catch {
      return undefined;
    }
  }
  return asRecord(execution.data);
}
