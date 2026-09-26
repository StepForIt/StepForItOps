import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  EVENTS,
  N8N_API_PORT,
  N8nApiPort,
  N8nWorkflow,
  STUB_TAG,
  SubWorkflowTarget,
  TEST_COPY_TAG,
  TestCompletedEvent,
  buildStubWorkflow,
  extractSubWorkflowRefs,
  remapSubWorkflowRefs,
  stubWorkflowName,
  testCopyName,
  msg,
} from '@nwm/core';
import { TestRun } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EventBusService } from '../../infra/events/event-bus.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { InstancesService } from '../instances/instances.service';
import { findWebhookPath } from './webhook-finder';
import { WebhookTargetService } from './webhook-target.service';
import { WorkflowRefreshService } from './workflow-refresh.service';
import { tagWorkflow } from './tag-workflow';
import { PrismaListArgs } from '../../common/crud/paginate';

export interface MockedCopyResult {
  testRun: TestRun;
  copyN8nId?: string;
  /** Nœuds épinglés : ils ne s'exécuteront pas. */
  pinned: string[];
  /** Bouchons de sous-workflow posés (ou réutilisés) pour ce test. */
  stubs: Array<{ calledName: string; stubName: string; stubN8nId: string; reused: boolean }>;
}

@Injectable()
export class TesterService {
  private readonly logger = new Logger(TesterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly workflows: WorkflowsService,
    private readonly instances: InstancesService,
    private readonly webhookTarget: WebhookTargetService,
    private readonly refresh: WorkflowRefreshService,
    @Inject(N8N_API_PORT) private readonly n8n: N8nApiPort,
  ) {}

  /** Test complet : appelle le webhook du workflow avec le payload fourni. */
  async runViaWebhook(workflowId: string, payload: unknown): Promise<TestRun> {
    await this.refresh.refresh(workflowId);
    const { workflow, raw } = await this.workflows.getRaw(workflowId);
    const webhook = findWebhookPath(raw);
    if (!webhook) {
      throw new BadRequestException(msg('platform.testerNoWebhook'));
    }
    const config = await this.instances.getConfig(workflow.instanceId);
    const target = await this.webhookTarget.check(config, workflow, webhook);
    if (!target.ok) throw new BadRequestException(target.reason);

    const run = await this.prisma.testRun.create({
      data: { workflowId, mode: 'webhook', status: 'running', input: payload as object },
    });

    let status = 'success';
    let output: unknown;
    let errorMessage: string | undefined;
    try {
      output = await this.n8n.callWebhook(config, webhook.path, payload, webhook.method);
    } catch (error) {
      status = 'error';
      errorMessage = (error as Error).message;
    }

    const finished = await this.prisma.testRun.update({
      where: { id: run.id },
      data: { status, output: output as object | undefined, error: errorMessage, finishedAt: new Date() },
    });
    const event: TestCompletedEvent = { testRunId: run.id, workflowId, status };
    this.eventBus.emit(EVENTS.testCompleted, event);
    return finished;
  }

  /**
   * Test bouchonné : une copie `[TEST]` du workflow où les nœuds choisis sont
   * épinglés (`pinData`) — n8n ne les exécute pas et sert la donnée épinglée.
   * Rien ne sort donc du système pour ces nœuds-là.
   *
   * Les appels de sous-workflow ont un second traitement possible : les rerouter
   * vers un workflow `[BOUCHON]` créé au besoin. L'appel part vraiment, on lit
   * donc dans n8n ce qui aurait été envoyé — mais il n'atterrit nulle part.
   *
   * Les deux sont étiquetés dans n8n : c'est le tag, et non le préfixe du nom,
   * qui les sort ensuite du miroir (cf. `tester-workflows.where.ts`).
   */
  async createMockedCopy(
    workflowId: string,
    input: {
      /** Nœuds à épingler : ils ne s'exécutent pas. */
      nodeNames?: string[];
      /** Sorties factices sur mesure, par nœud (défaut : un item marqué). */
      pins?: Record<string, unknown[]>;
      /** Rerouter les appels de sous-workflow non épinglés vers un bouchon. */
      stubSubWorkflows?: boolean;
    },
  ): Promise<MockedCopyResult> {
    await this.refresh.refresh(workflowId);
    const { workflow, raw } = await this.workflows.getRaw(workflowId);
    const config = await this.instances.getConfig(workflow.instanceId);
    const json = raw as unknown as N8nWorkflow;

    const pinned = input.nodeNames ?? Object.keys(input.pins ?? {});
    const pins: Record<string, unknown[]> = { ...(input.pins ?? {}) };
    for (const nodeName of pinned) {
      // Marqué : un résultat de test ne doit jamais pouvoir passer pour un vrai.
      if (!pins[nodeName]) pins[nodeName] = [{ json: { __bouchon: true, noeud: nodeName } }];
    }

    let candidate = json;
    const stubs: MockedCopyResult['stubs'] = [];
    if (input.stubSubWorkflows) {
      const remote = await this.n8n.listWorkflows(config);
      const targets = new Map<string, SubWorkflowTarget>();
      for (const ref of extractSubWorkflowRefs(json)) {
        // Un nœud déjà épinglé n'appelle personne : pas de bouchon à lui créer.
        if (ref.dynamic || pinned.includes(ref.nodeName)) continue;
        const called = await this.prisma.workflow.findFirst({
          where: { instanceId: workflow.instanceId, externalId: ref.externalId },
          select: { name: true },
        });
        const calledName = called?.name ?? ref.label ?? `workflow ${ref.externalId}`;
        const stubName = stubWorkflowName(calledName);
        // Réutilisé s'il existe : les bouchons s'accumuleraient à chaque test.
        const existing = remote.find((w) => w.name === stubName);
        const stub = existing ?? (await this.n8n.createWorkflow(config, buildStubWorkflow(calledName)));
        if (stub.id === undefined) continue;
        // Y compris sur un bouchon réutilisé : ceux d'avant le tag le reçoivent ici.
        await tagWorkflow(this.n8n, config, String(stub.id), STUB_TAG, this.logger);
        targets.set(ref.externalId, { externalId: String(stub.id), name: stubName });
        stubs.push({ calledName, stubName, stubN8nId: String(stub.id), reused: Boolean(existing) });
      }
      candidate = remapSubWorkflowRefs(candidate, targets).workflow;
    }

    const copy: N8nWorkflow = {
      ...candidate,
      id: undefined,
      name: testCopyName(json.name),
      active: false,
      pinData: { ...(json.pinData ?? {}), ...pins },
    };
    const created = await this.n8n.createWorkflow(config, copy);

    // Une copie dont n8n n'a pas retenu les données épinglées enverrait pour de vrai :
    // c'est exactement ce que le geste voulait éviter, on la supprime plutôt que de
    // laisser croire au bouchonnage.
    if (created.id !== undefined && pinned.length > 0) {
      const fresh = await this.n8n.getWorkflow(config, String(created.id));
      const lost = pinned.filter((nodeName) => !fresh.pinData?.[nodeName]);
      if (lost.length > 0) {
        await this.n8n.deleteWorkflow(config, String(created.id)).catch(() => undefined);
        throw new BadRequestException(msg('platform.testerPinLost', { nodes: lost.join(', ') }));
      }
    }

    if (created.id !== undefined)
      await tagWorkflow(this.n8n, config, String(created.id), TEST_COPY_TAG, this.logger);

    const testRun = await this.prisma.testRun.create({
      data: {
        workflowId,
        mode: 'mocked-copy',
        status: 'pending',
        input: { pinned, stubs } as object,
        output: {
          copyN8nId: created.id,
          note: msg('platform.testerCopyCreated'),
        } as object,
      },
    });
    return { testRun, copyN8nId: created.id ? String(created.id) : undefined, pinned, stubs };
  }

  /**
   * Ce qui est parti dans les bouchons : chaque exécution du workflow `[BOUCHON]`
   * est un appel qui aurait eu lieu pour de vrai.
   */
  async stubCalls(workflowId: string, stubN8nId: string, limit = 10) {
    const { workflow } = await this.workflows.getRaw(workflowId);
    const config = await this.instances.getConfig(workflow.instanceId);
    return this.n8n.listExecutions(config, stubN8nId, limit, { includeData: true });
  }

  /** Rapatrie le résultat de la dernière exécution n8n d'un workflow. */
  async fetchLastExecution(workflowId: string): Promise<TestRun> {
    const { workflow } = await this.workflows.getRaw(workflowId);
    const config = await this.instances.getConfig(workflow.instanceId);
    const executions = await this.n8n.listExecutions(config, workflow.externalId, 1);
    const last = executions[0];

    const run = await this.prisma.testRun.create({
      data: {
        workflowId,
        mode: 'webhook',
        status: last ? (last.status === 'success' ? 'success' : 'error') : 'error',
        output: (last ?? { note: msg('platform.testerNoExecution') }) as unknown as object,
        finishedAt: new Date(),
      },
    });
    this.eventBus.emit(EVENTS.testCompleted, { testRunId: run.id, workflowId, status: run.status });
    return run;
  }

  list(workflowId?: string, instanceId?: string, args: PrismaListArgs = {}): Promise<TestRun[]> {
    return this.prisma.testRun.findMany({
      where: {
        ...(workflowId ? { workflowId } : {}),
        ...(instanceId ? { workflow: { instanceId } } : {}),
      },
      orderBy: args.orderBy ?? { startedAt: 'desc' },
      take: 100,
      include: { workflow: { select: { name: true, instanceId: true } } },
    });
  }
}
