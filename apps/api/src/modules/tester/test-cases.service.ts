import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  N8N_API_PORT,
  N8nApiPort,
  N8nInstanceConfig,
  SnapshotDiff,
  compareSnapshots,
  extractExecutionSnapshot,
} from '@nwm/core';
import { TestCase } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { InstancesService } from '../instances/instances.service';
import { findWebhookPath } from './webhook-finder';
import { WebhookTargetService } from './webhook-target.service';
import { WorkflowRefreshService } from './workflow-refresh.service';

/** Attente max de l'exécution déclenchée par le rejeu (poll n8n). */
const RUN_TIMEOUT_MS = 30_000;
const RUN_POLL_MS = 1500;
const NAME_MAX = 60;

/** Ids n8n : numériques en pratique, mais on ne parie pas dessus (BigInt lève sur du texte). */
function isAfter(id: string, other: string): boolean {
  const a = Number(id);
  const b = Number(other);
  return Number.isFinite(a) && Number.isFinite(b) ? a > b : id > other;
}

/**
 * n8n répond 404 « not registered » quand le workflow n'est pas actif : rien ne
 * partira, l'attente d'une exécution serait du temps perdu suivi d'un message vague.
 */
function isWebhookNotRegistered(message: string): boolean {
  return /404/.test(message) && /not registered/i.test(message);
}

export interface TestCaseRunResult {
  id: string;
  status: 'passed' | 'failed' | 'error';
  diffs: SnapshotDiff[];
  /** Ce qui s'est passé, en une phrase : synthèse des écarts, ou raison du blocage. */
  message?: string;
  /** Exécution n8n déclenchée par le rejeu, quand il y en a eu une. */
  executionId?: string;
}

/**
 * Cas de test enregistrés : une exécution réelle jugée bonne devient la
 * référence — son entrée webhook est rejouée, la sortie du dernier nœud de la
 * NOUVELLE exécution est comparée (normalisée) au snapshot. On relit
 * l'exécution déclenchée plutôt que la réponse HTTP du webhook : celle-ci
 * dépend du responseMode et ne reflète pas toujours la sortie du workflow.
 */
@Injectable()
export class TestCasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowsService,
    private readonly instances: InstancesService,
    private readonly webhookTarget: WebhookTargetService,
    private readonly refresh: WorkflowRefreshService,
    @Inject(N8N_API_PORT) private readonly n8n: N8nApiPort,
  ) {}

  list(workflowId: string): Promise<TestCase[]> {
    return this.prisma.testCase.findMany({ where: { workflowId }, orderBy: { createdAt: 'asc' } });
  }

  /** Exécutions récentes proposées comme référence (l'UI en fait un cas d'un clic). */
  async recentExecutions(
    workflowId: string,
  ): Promise<Array<{ id: string; status: string; startedAt?: string; mode?: string }>> {
    const { workflow } = await this.workflows.getRaw(workflowId);
    const config = await this.instances.getConfig(workflow.instanceId);
    const executions = await this.n8n.listExecutions(config, workflow.externalId, 20);
    return executions.map((e) => ({ id: e.id, status: e.status, startedAt: e.startedAt, mode: e.mode }));
  }

  /** Une exécution réelle devient LE comportement attendu. */
  async createFromExecution(workflowId: string, executionId: string, name?: string): Promise<TestCase> {
    const { workflow, raw } = await this.workflows.getRaw(workflowId);
    const webhook = findWebhookPath(raw);
    if (!webhook) {
      throw new BadRequestException(
        'Ce workflow n’expose pas de webhook : rien à rejouer. Les cas de test demandent un déclencheur webhook.',
      );
    }
    const config = await this.instances.getConfig(workflow.instanceId);
    const execution = await this.n8n.getExecution(config, executionId, { includeData: true });
    const snapshot = extractExecutionSnapshot(execution.data, webhook.node);
    if (!snapshot.lastNode || snapshot.items.length === 0) {
      throw new BadRequestException(
        'Exécution sans données exploitables (purgée par n8n, ou sans sortie) : choisis-en une autre.',
      );
    }
    return this.prisma.testCase.create({
      data: {
        workflowId,
        name: (name?.trim() || `Comme l'exécution ${executionId}`).slice(0, NAME_MAX),
        payload: (snapshot.webhookPayload ?? undefined) as object | undefined,
        expected: snapshot.items as unknown as object,
        sourceExecutionId: executionId,
      },
    });
  }

  async remove(id: string): Promise<{ id: string }> {
    await this.prisma.testCase.delete({ where: { id } });
    return { id };
  }

  /** Rejoue UN cas : webhook → attend la nouvelle exécution → compare au snapshot. */
  async run(id: string): Promise<TestCaseRunResult> {
    const testCase = await this.prisma.testCase.findUnique({ where: { id } });
    if (!testCase) throw new NotFoundException(`Cas de test ${id} introuvable`);
    await this.refresh.refresh(testCase.workflowId);
    const { workflow, raw } = await this.workflows.getRaw(testCase.workflowId);
    const webhook = findWebhookPath(raw);
    if (!webhook) {
      return this.conclude(
        testCase,
        'error',
        [],
        'Le workflow n’a plus de nœud webhook : il n’y a plus rien à rejouer.',
      );
    }
    const config = await this.instances.getConfig(workflow.instanceId);

    const target = await this.webhookTarget.check(config, workflow, webhook);
    if (!target.ok) return this.conclude(testCase, 'error', [], target.reason);

    const before = await this.latestExecutionId(config, workflow.externalId);
    let webhookError: string | undefined;
    try {
      await this.n8n.callWebhook(config, webhook.path, testCase.payload ?? {}, webhook.method);
    } catch (error) {
      // L'appel peut « échouer » côté HTTP alors que l'exécution part quand même
      // (responseMode, erreur dans un nœud) : l'exécution relue fait foi. Mais un
      // webhook non enregistré, lui, ne déclenche RIEN — inutile d'attendre.
      webhookError = (error as Error).message;
      if (isWebhookNotRegistered(webhookError)) {
        return this.conclude(
          testCase,
          'error',
          [],
          `Webhook non enregistré dans n8n : le workflow doit être ACTIF pour répondre sur /webhook/${webhook.path}. (${webhookError})`,
        );
      }
    }

    const execution = await this.waitForNewExecution(config, workflow.externalId, before);
    if (!execution) {
      const cause = webhookError
        ? `Le webhook a répondu en erreur : ${webhookError}`
        : `Le webhook a répondu, mais aucune exécution n'est apparue en ${Math.round(RUN_TIMEOUT_MS / 1000)} s (exécution trop longue, ou non sauvegardée par n8n).`;
      return this.conclude(testCase, 'error', [], `Aucune exécution déclenchée. ${cause}`);
    }
    if (!execution.done) {
      return this.conclude(
        testCase,
        'error',
        [],
        `L'exécution ${execution.id} tournait encore après ${Math.round(RUN_TIMEOUT_MS / 1000)} s : rien à comparer. Relance quand elle sera terminée.`,
        execution.id,
      );
    }
    const detailed = await this.n8n.getExecution(config, execution.id, { includeData: true });
    const snapshot = extractExecutionSnapshot(detailed.data, webhook.node);
    const comparison = compareSnapshots(testCase.expected, snapshot.items);
    // Le nœud comparé est nommé : « ça a fail » sans dire OÙ oblige à rouvrir n8n.
    const where = snapshot.lastNode ? ` (sortie du nœud « ${snapshot.lastNode} »)` : '';
    return this.conclude(
      testCase,
      comparison.match ? 'passed' : 'failed',
      comparison.diffs,
      `${comparison.summary}${comparison.match ? '' : where}`,
      execution.id,
    );
  }

  async runAll(workflowId: string): Promise<{ results: TestCaseRunResult[] }> {
    const cases = await this.prisma.testCase.findMany({
      where: { workflowId, enabled: true },
      orderBy: { createdAt: 'asc' },
    });
    const results: TestCaseRunResult[] = [];
    for (const testCase of cases) results.push(await this.run(testCase.id));
    return { results };
  }

  private async latestExecutionId(config: N8nInstanceConfig, externalId: string): Promise<string> {
    const executions = await this.n8n.listExecutions(config, externalId, 1);
    return executions[0]?.id ?? '0';
  }

  /**
   * Attend la fin de l'exécution déclenchée. On distingue « rien n'est parti » de
   * « c'est parti mais c'est encore en cours » : le second n'est pas un webhook mort,
   * c'est un workflow plus lent que notre budget d'attente.
   */
  private async waitForNewExecution(
    config: N8nInstanceConfig,
    externalId: string,
    afterId: string,
  ): Promise<{ id: string; done: boolean } | null> {
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    let pending: string | null = null;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, RUN_POLL_MS));
      const executions = await this.n8n.listExecutions(config, externalId, 5);
      const fresh = executions
        .filter((e) => isAfter(e.id, afterId))
        .sort((a, b) => (isAfter(a.id, b.id) ? 1 : -1))[0];
      if (!fresh) continue;
      pending = fresh.id;
      if (fresh.status !== 'running' && fresh.status !== 'waiting') return { id: fresh.id, done: true };
    }
    return pending ? { id: pending, done: false } : null;
  }

  private async conclude(
    testCase: TestCase,
    status: TestCaseRunResult['status'],
    diffs: SnapshotDiff[],
    message?: string,
    executionId?: string,
  ): Promise<TestCaseRunResult> {
    await this.prisma.testCase.update({
      where: { id: testCase.id },
      data: {
        lastStatus: status,
        lastRunAt: new Date(),
        lastDiff: diffs as unknown as object,
        lastMessage: message ?? null,
        lastExecutionId: executionId ?? null,
      },
    });
    return { id: testCase.id, status, diffs, message, executionId };
  }
}
