import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  BENCH_TAG,
  BenchOutcome,
  N8N_API_PORT,
  N8nApiPort,
  N8nInstanceConfig,
  benchImpacts,
  buildNodeBenchWorkflow,
  evaluateBenchGate,
  isBenchWorkflow,
  planNodeBench,
  readBenchOutcome,
  msg,
} from '@nwm/core';
import { TestRun } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { InstancesService } from '../instances/instances.service';
import { tagWorkflow } from './tag-workflow';

export interface RunBenchInput {
  nodeName: string;
  /** Items servis à chaque nœud simulé (défaut : un item vide). */
  feeds?: Record<string, Array<Record<string, unknown>>>;
  /** Contournement de la porte de production, coché par un humain. */
  force?: boolean;
}

export interface BenchRunResult {
  testRun: TestRun;
  /** Le banc, gardé pour le debug : il est réutilisé au prochain essai du même nœud. */
  benchN8nId: string;
  benchName: string;
  reused: boolean;
  outcome: BenchOutcome;
  executionId?: string;
}

export interface BenchSummary {
  externalId: string;
  name: string;
  active: boolean;
}

/** Le webhook de prod met ~1 s à s'enregistrer après l'activation. */
const CALL_ATTEMPTS = 4;
const CALL_DELAY_MS = 700;

/**
 * Exécution d'un banc d'essai : le nœud seul, nourri de données figées,
 * déclenché par webhook. Le banc est CONSERVÉ — nommé et étiqueté — parce que
 * le moment où l'on en a besoin est justement celui où l'essai a mal tourné :
 * un workflow supprimé aussitôt ne laisse rien à rouvrir dans n8n.
 */
@Injectable()
export class NodeBenchService {
  private readonly logger = new Logger(NodeBenchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowsService,
    private readonly instances: InstancesService,
    @Inject(N8N_API_PORT) private readonly n8n: N8nApiPort,
  ) {}

  async run(workflowId: string, input: RunBenchInput): Promise<BenchRunResult> {
    // Le banc recopie le nœud : partir du miroir reviendrait à tester la version
    // d'hier, et à conclure sur un nœud que personne n'exécute plus.
    const { workflow, raw } = await this.workflows.getFreshRaw(workflowId);
    const plan = planNodeBench(raw, input.nodeName);
    if (plan.blocked) {
      throw new BadRequestException(plan.issues.find((i) => i.severity === 'blocking')?.message);
    }

    const gate = evaluateBenchGate(benchImpacts(raw, plan), {
      env: workflow.env,
      active: workflow.active,
      force: input.force,
    });
    if (gate.blocked) throw new BadRequestException(gate.reasons.join(' — '));

    const config = await this.instances.getConfig(workflow.instanceId);
    const webhookPath = `nwm-bench-${randomUUID()}`;
    const bench = buildNodeBenchWorkflow({
      workflow: raw,
      nodeName: input.nodeName,
      webhookPath,
      feeds: input.feeds ?? {},
    });

    const { externalId, reused } = await this.upsertBench(config, bench.name, bench);
    const run = await this.prisma.testRun.create({
      data: {
        workflowId,
        mode: 'node-bench',
        status: 'running',
        input: { nodeName: input.nodeName, feeds: input.feeds ?? {}, forced: !!input.force } as object,
      },
    });

    try {
      await this.n8n.activateWorkflow(config, externalId, true);
      await this.callWithRetry(config, webhookPath);
      const { outcome, executionId } = await this.readOutcome(config, externalId, input.nodeName);
      const testRun = await this.prisma.testRun.update({
        where: { id: run.id },
        data: {
          // Un nœud qui n'a pas tourné n'est pas un succès : seul `ok` l'est.
          status: outcome.status === 'ok' ? 'success' : 'error',
          output: { items: outcome.items, benchN8nId: externalId, executionId } as object,
          error: outcome.error,
          finishedAt: new Date(),
        },
      });
      return { testRun, benchN8nId: externalId, benchName: bench.name, reused, outcome, executionId };
    } catch (error) {
      const message = (error as Error).message;
      const testRun = await this.prisma.testRun.update({
        where: { id: run.id },
        data: {
          status: 'error',
          error: message,
          output: { benchN8nId: externalId } as object,
          finishedAt: new Date(),
        },
      });
      return {
        testRun,
        benchN8nId: externalId,
        benchName: bench.name,
        reused,
        outcome: { status: 'failed', items: [], error: message },
      };
    } finally {
      // Désactivé, jamais supprimé : un banc actif garderait un webhook ouvert
      // sur la donnée figée d'un essai passé.
      await this.n8n.activateWorkflow(config, externalId, false).catch(() => undefined);
    }
  }

  /** Les bancs d'une instance, pour les rouvrir ou faire le ménage. */
  async list(instanceId: string): Promise<BenchSummary[]> {
    const config = await this.instances.getConfig(instanceId);
    const all = await this.n8n.listWorkflows(config);
    return all
      .filter((workflow) => isBenchWorkflow(workflow))
      .map((workflow) => ({
        externalId: String(workflow.id),
        name: workflow.name,
        active: !!workflow.active,
      }));
  }

  async remove(instanceId: string, externalId: string): Promise<{ externalId: string }> {
    const config = await this.instances.getConfig(instanceId);
    const workflow = await this.n8n.getWorkflow(config, externalId);
    // Garde-fou : cette route supprime, et rien ne garantit que l'id vienne bien
    // de `list()` — un id recopié à la main viserait un workflow de production.
    if (!isBenchWorkflow(workflow)) {
      throw new BadRequestException(msg('platform.benchNotABench', { name: workflow.name }));
    }
    await this.n8n.activateWorkflow(config, externalId, false).catch(() => undefined);
    await this.n8n.deleteWorkflow(config, externalId);
    return { externalId };
  }

  /**
   * Un banc par (workflow, nœud) : réutilisé et réécrit plutôt que dupliqué,
   * sinon chaque essai laisse un workflow de plus dans n8n. Réécrit inactif —
   * n8n refuse une mise à jour qui changerait le webhook d'un workflow actif.
   */
  private async upsertBench(
    config: N8nInstanceConfig,
    name: string,
    bench: ReturnType<typeof buildNodeBenchWorkflow>,
  ): Promise<{ externalId: string; reused: boolean }> {
    const existing = (await this.n8n.listWorkflows(config)).find((workflow) => workflow.name === name);
    if (!existing?.id) {
      const created = await this.n8n.createWorkflow(config, bench);
      const externalId = String(created.id);
      await tagWorkflow(this.n8n, config, externalId, BENCH_TAG, this.logger);
      return { externalId, reused: false };
    }

    const externalId = String(existing.id);
    await this.n8n.activateWorkflow(config, externalId, false).catch(() => undefined);
    await this.n8n.updateWorkflow(config, externalId, bench);
    await tagWorkflow(this.n8n, config, externalId, BENCH_TAG, this.logger);
    return { externalId, reused: true };
  }

  private async callWithRetry(config: N8nInstanceConfig, path: string): Promise<void> {
    let lastError: Error = new Error(msg('platform.benchUnreachable'));
    for (let attempt = 0; attempt < CALL_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(CALL_DELAY_MS);
      try {
        await this.n8n.callWebhook(config, path, {});
        return;
      } catch (error) {
        lastError = error as Error;
      }
    }
    throw lastError;
  }

  /**
   * Le résultat se lit dans l'EXÉCUTION, pas dans la réponse du webhook : c'est
   * elle qui porte l'erreur du nœud, que `continueRegularOutput` a rangée dans
   * un item d'apparence ordinaire.
   */
  private async readOutcome(
    config: N8nInstanceConfig,
    benchN8nId: string,
    nodeName: string,
  ): Promise<{ outcome: BenchOutcome; executionId?: string }> {
    const [last] = await this.n8n.listExecutions(config, benchN8nId, 1, { includeData: true });
    if (!last) {
      return {
        outcome: { status: 'unknown', items: [], error: msg('platform.benchNoExecution') },
      };
    }
    const detailed =
      last.data !== undefined
        ? last
        : await this.n8n.getExecution(config, last.id, { includeData: true }).catch(() => last);
    return { outcome: readBenchOutcome(detailed, nodeName), executionId: detailed.id };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
