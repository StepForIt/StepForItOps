// Le seed de la démo : les workflows du jeu d'essai, et 45 jours d'histoire
// (exécutions, erreurs regroupées, appels LLM) pour que tableau de bord,
// erreurs, performance et coûts aient quelque chose à montrer.
//
// Tout est dérivé d'un générateur à graine FIXE, et daté par rapport à
// maintenant : deux captures à une semaine d'intervalle montrent le même parc,
// avec les mêmes courbes, au même endroit de l'écran.
//
// Le client Prisma et `@nwm/core` sont empruntés à l'api (compilée juste avant
// par `scripts/api.sh`) : c'est là que Prisma est généré, et l'empreinte
// d'un workflow doit être celle que calcule la plateforme — sinon la première
// synchro le croirait modifié, et l'assistant refuserait d'écrire (409).
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIENTS, ENVS, INSTANCES, WORKFLOWS } from './dataset.mjs';

const API = join(dirname(fileURLToPath(import.meta.url)), '../api');
const requireApi = createRequire(join(API, 'package.json'));
const { PrismaClient } = requireApi('@prisma/client');
const { hashWorkflow } = requireApi(join(API, 'dist/packages/core/src/index.js'));

const url = process.env.DATABASE_URL ?? '';
const dbName = url.split('/').pop()?.split('?')[0] ?? '';
if (!dbName.endsWith('_demo')) {
  console.error(`Base « ${dbName} » refusée : le seed de démo la VIDE, elle doit s'appeler « …_demo ».`);
  process.exit(1);
}
const N8N_PORT = Number(process.env.DEMO_N8N_PORT ?? 3922);

const prisma = new PrismaClient();
const DAY = 86_400_000;
const NOW = Date.now();

/** mulberry32 : un aléa reproductible. */
let seed = 20260926;
function random() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const jitter = (value, spread = 0.35) => Math.round(value * (1 - spread + random() * 2 * spread));

/**
 * Le rythme de chaque workflow de prod : combien d'exécutions un jour donné
 * (`d` jours avant aujourd'hui), combien de temps, et quand il échoue.
 */
const PROFILES = {
  'commandes-prod': { perDay: () => jitter(38), ms: () => jitter(1300) },
  'paniers-prod': { perDay: () => 24, ms: () => jitter(6200) },
  'support-prod': { perDay: () => jitter(56), ms: () => jitter(4300) },
  // La dérive : le fournisseur ralentit depuis une semaine.
  'stocks-prod': { perDay: () => 48, ms: (d) => jitter(d < 7 ? 4700 : 1500, 0.2) },
  'rapport-prod': { perDay: (d, date) => (date.getDay() === 1 ? 1 : 0), ms: () => jitter(11000) },
  'pdf-prod': { perDay: (d, date) => (date.getDate() === 1 ? 42 : 0), ms: () => jitter(2600) },
  'facturation-prod': { perDay: (d, date) => (date.getDate() === 1 ? 1 : 0), ms: () => jitter(184000, 0.1) },
  'impayes-prod': { perDay: () => 2, ms: () => jitter(7800) },
  'qonto-prod': { perDay: () => 6, ms: () => jitter(3100) },
  'veille-prod': { perDay: (d, date) => (date.getDay() === 5 ? 1 : 0), ms: () => jitter(21000) },
};

/** Les problèmes du parc : quand ils frappent, et ce que la plateforme en a fait. */
const PROBLEMS = [
  {
    workflow: 'stocks-prod',
    node: 'Stocks fournisseur',
    nodeType: 'n8n-nodes-base.httpRequest',
    message: 'The connection timed out after 30000ms (ETIMEDOUT) — edi.atelier-bougies.fr',
    category: 'timeout',
    strikes: (d) => d < 7 && random() < 0.06,
  },
  {
    workflow: 'qonto-prod',
    node: 'Transactions Qonto',
    nodeType: 'n8n-nodes-base.httpRequest',
    message: 'Request failed with status code 401 — Unauthorized: the access token has expired',
    category: 'auth',
    strikes: (d) => ((d >= 7 && d <= 9) || d <= 2) && random() < 0.3,
    // Déclaré traité il y a six jours… et revenu : c'est la rechute du tableau de bord.
    resolvedDaysAgo: 6,
  },
  {
    workflow: 'support-prod',
    node: 'Claude Sonnet',
    nodeType: '@n8n/n8n-nodes-langchain.lmChatAnthropic',
    message: '429 rate_limit_error: Number of request tokens has exceeded your per-minute rate limit',
    category: 'rate-limit',
    strikes: (d) => d < 12 && random() < 0.012,
  },
  {
    workflow: 'paniers-prod',
    node: 'Envoyer la relance',
    nodeType: 'n8n-nodes-base.gmail',
    message: 'Invalid email address: "julie.martin@gmial.con"',
    category: 'data',
    strikes: (d) => d < 2 && random() < 0.08,
  },
  {
    workflow: 'commandes-prod',
    node: 'Créer la commande',
    nodeType: 'n8n-nodes-base.airtable',
    message: 'INVALID_VALUE_FOR_COLUMN: Field "Montant" cannot accept the provided value',
    category: 'data',
    strikes: (d) => d >= 14 && d <= 17 && random() < 0.15,
    resolvedDaysAgo: 13,
    stayResolved: true,
  },
];

/** Les appels LLM : modèle, tokens typiques et prix au million (entrée, sortie). */
const LLM = {
  paniers: { node: 'GPT-4.1 mini', model: 'gpt-4.1-mini', prompt: 1600, completion: 260, price: [0.4, 1.6] },
  support: { node: 'Claude Sonnet', model: 'claude-sonnet-5', prompt: 4200, completion: 380, price: [3, 15] },
  veille: { node: 'Claude Opus', model: 'claude-opus-5-5', prompt: 38000, completion: 2200, price: [15, 75] },
};

async function truncateAll() {
  const tables = await prisma.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  if (list) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

async function main() {
  await truncateAll();
  await prisma.platformSettings.create({
    data: { id: 'default', envs: ENVS, envChain: ENVS.map((e) => e.id) },
  });

  const clients = {};
  for (const client of CLIENTS)
    clients[client.key] = await prisma.client.create({ data: { name: client.name } });
  const instances = {};
  for (const instance of INSTANCES) {
    instances[instance.key] = await prisma.instance.create({
      data: {
        name: instance.name,
        baseUrl: `http://127.0.0.1:${N8N_PORT}/i/${instance.key}`,
        apiKey: 'demo',
        clientId: clients[instance.client].id,
      },
    });
  }

  const byExternal = {};
  for (const wf of WORKFLOWS) {
    byExternal[wf.raw.id] = await prisma.workflow.create({
      data: {
        instanceId: instances[wf.instance].id,
        externalId: wf.raw.id,
        name: wf.raw.name,
        active: wf.raw.active,
        tags: wf.raw.tags.map((t) => t.name),
        hash: hashWorkflow(wf.raw),
        raw: wf.raw,
        upstreamUpdatedAt: new Date(wf.raw.updatedAt),
        minutesSavedPerExecution: wf.env === 'prod' ? wf.minutes : null,
        version: '1.2.0',
      },
    });
  }

  // L'historique : la release 1.2.0 mise en service il y a trois semaines — pour la
  // dev, le contenu de la prod d'alors, d'où une vraie montée de version à la
  // promotion —, puis le snapshot de synchro de l'état courant, point de retour
  // de l'assistant.
  const released = new Date(NOW - 21 * DAY);
  for (const wf of WORKFLOWS) {
    const row = byExternal[wf.raw.id];
    const prod = WORKFLOWS.find((other) => other.family === wf.family && other.env === 'prod') ?? wf;
    await prisma.workflowVersion.create({
      data: {
        workflowId: row.id,
        hash: hashWorkflow(prod.raw),
        raw: prod.raw,
        semver: '1.2.0',
        createdAt: released,
      },
    });
    await prisma.workflowVersion.create({
      data: { workflowId: row.id, hash: row.hash, raw: wf.raw, createdAt: new Date(wf.raw.updatedAt) },
    });
  }

  const stats = [];
  const errors = [];
  const usages = [];
  const nextId = {};
  for (let d = 44; d >= 0; d--) {
    const date = new Date(NOW - d * DAY);
    for (const [externalId, profile] of Object.entries(PROFILES)) {
      const wf = byExternal[externalId];
      const count = profile.perDay(d, date);
      for (let i = 0; i < count; i++) {
        const startedAt = new Date(NOW - d * DAY - random() * DAY * (d === 0 ? 0.4 : 1));
        const ms = profile.ms(d);
        const instanceId = wf.instanceId;
        nextId[instanceId] = (nextId[instanceId] ?? 40000) + 1;
        const executionId = String(nextId[instanceId]);
        const problem = PROBLEMS.find((p) => p.workflow === externalId && p.strikes(d));
        stats.push({
          instanceId,
          executionId,
          externalWorkflowId: externalId,
          status: problem ? 'error' : 'success',
          mode: 'trigger',
          startedAt,
          stoppedAt: new Date(startedAt.getTime() + ms),
          durationMs: ms,
        });
        if (problem) {
          errors.push({ problem, instanceId, executionId, wf, startedAt, ms });
          continue;
        }
        const llm = LLM[externalId.replace(/-prod$/, '')];
        if (llm) {
          const prompt = jitter(llm.prompt, 0.25);
          const completion = jitter(llm.completion, 0.4);
          usages.push({
            instanceId,
            executionId,
            externalWorkflowId: externalId,
            nodeName: llm.node,
            runIndex: 0,
            callIndex: 0,
            itemIndex: 0,
            model: llm.model,
            promptTokens: prompt,
            completionTokens: completion,
            totalTokens: prompt + completion,
            costUsd: (prompt * llm.price[0] + completion * llm.price[1]) / 1e6,
            startedAt,
          });
        }
      }
    }
  }
  // Les essais en dev coûtent aussi : quelques appels par jour, que la page range sous le même workflow.
  for (let d = 20; d >= 0; d--) {
    for (const family of ['paniers', 'support']) {
      const wf = byExternal[`${family}-dev`];
      for (let i = 0; i < 3; i++) {
        nextId[wf.instanceId] += 1;
        const llm = LLM[family];
        usages.push({
          instanceId: wf.instanceId,
          executionId: String(nextId[wf.instanceId]),
          externalWorkflowId: wf.externalId,
          nodeName: llm.node,
          runIndex: 0,
          callIndex: 0,
          itemIndex: 0,
          model: llm.model,
          promptTokens: llm.prompt,
          completionTokens: llm.completion,
          totalTokens: llm.prompt + llm.completion,
          costUsd: (llm.prompt * llm.price[0] + llm.completion * llm.price[1]) / 1e6,
          startedAt: new Date(NOW - d * DAY - random() * DAY),
        });
      }
    }
  }
  await prisma.executionStat.createMany({ data: stats });
  await prisma.llmUsage.createMany({ data: usages });

  for (const problem of PROBLEMS) {
    const hits = errors.filter((e) => e.problem === problem);
    if (hits.length === 0) continue;
    const wf = hits[0].wf;
    const first = hits[0].startedAt;
    const last = hits[hits.length - 1].startedAt;
    const resolvedAt = problem.resolvedDaysAgo ? new Date(NOW - problem.resolvedDaysAgo * DAY) : null;
    const relapsed = resolvedAt && !problem.stayResolved && last > resolvedAt;
    const group = await prisma.errorGroup.create({
      data: {
        instanceId: wf.instanceId,
        workflowId: wf.id,
        externalWorkflowId: wf.externalId,
        workflowName: wf.name,
        signature: `${wf.externalId}|${problem.node}|demo`,
        failedNode: problem.node,
        failedNodeType: problem.nodeType,
        pattern: problem.message,
        sample: problem.message,
        category: problem.category,
        status: problem.stayResolved ? 'resolved' : 'open',
        occurrences: hits.length,
        regressions: relapsed ? 1 : 0,
        firstSeenAt: first,
        lastSeenAt: last,
        resolvedAt: problem.stayResolved ? resolvedAt : null,
        resolvedBy: resolvedAt ? 'claire@atelier-nova.fr' : null,
        reopenedAt: relapsed ? hits.find((h) => h.startedAt > resolvedAt).startedAt : null,
        notifiedAt: first,
        createdAt: first,
      },
    });
    if (resolvedAt) {
      await prisma.errorGroupEvent.create({
        data: {
          groupId: group.id,
          type: 'resolved',
          author: 'claire@atelier-nova.fr',
          note: 'Jeton Qonto renouvelé.',
          createdAt: resolvedAt,
        },
      });
    }
    if (relapsed) {
      await prisma.errorGroupEvent.create({
        data: { groupId: group.id, type: 'regression', occurrences: 1, createdAt: group.reopenedAt },
      });
    }
    await prisma.executionError.createMany({
      data: hits.map((hit) => ({
        instanceId: hit.instanceId,
        workflowId: wf.id,
        executionId: hit.executionId,
        externalWorkflowId: wf.externalId,
        workflowName: wf.name,
        startedAt: hit.startedAt,
        stoppedAt: new Date(hit.startedAt.getTime() + hit.ms),
        mode: 'trigger',
        // Déjà détaillée : sinon la plateforme irait la redemander à n8n, qui n'en a aucune trace.
        detailState: 'fetched',
        failedNode: problem.node,
        failedNodeType: problem.nodeType,
        message: problem.message,
        groupId: group.id,
      })),
    });
  }

  await prisma.perfDriftAlert.create({
    data: { instanceId: byExternal['stocks-prod'].instanceId, externalWorkflowId: 'stocks-prod', ratio: 3.1 },
  });
  // « Depuis ta dernière visite » : il y a trois jours.
  await prisma.dashboardVisit.create({ data: { userEmail: 'demo' } });
  await prisma.$executeRawUnsafe(
    `UPDATE "DashboardVisit" SET "lastSeenAt" = now() - interval '3 days' WHERE "userEmail" = 'demo'`,
  );

  console.log(
    `Seed démo : ${WORKFLOWS.length} workflows, ${stats.length} exécutions, ${errors.length} erreurs, ${usages.length} appels LLM.`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
