import { Body, Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { TestCase, TestRun } from '@prisma/client';
import { MockedCopyResult, TesterService } from './tester.service';
import { MockPlan, MockPlanService } from './mock-plan.service';
import { NodeBenchPreview, NodeBenchPreviewService } from './node-bench-preview.service';
import { BenchRunResult, BenchSummary, NodeBenchService, RunBenchInput } from './node-bench.service';
import { TestCaseRunResult, TestCasesService } from './test-cases.service';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';
import { RefineListQuery, toPrismaListArgs, withTotalCount } from '../../common/crud/paginate';

@ModuleId('tester')
@Controller()
export class TesterController {
  constructor(
    private readonly tester: TesterService,
    private readonly cases: TestCasesService,
    private readonly mockPlanner: MockPlanService,
    private readonly benchPreview: NodeBenchPreviewService,
    private readonly bench: NodeBenchService,
  ) {}

  // --- Cas de test enregistrés (rejouables, gate de promotion) ---

  @Get('tester/cases/:workflowId')
  listCases(@Param('workflowId') workflowId: string): Promise<TestCase[]> {
    return this.cases.list(workflowId);
  }

  /** Exécutions récentes proposées comme référence d'un nouveau cas. */
  @Get('tester/executions/:workflowId')
  recentExecutions(@Param('workflowId') workflowId: string) {
    return this.cases.recentExecutions(workflowId);
  }

  @Post('tester/cases/from-execution/:workflowId')
  createCase(
    @Param('workflowId') workflowId: string,
    @Body() body: { executionId: string; name?: string },
  ): Promise<TestCase> {
    return this.cases.createFromExecution(workflowId, body.executionId, body.name);
  }

  @Post('tester/cases/:id/run')
  runCase(@Param('id') id: string): Promise<TestCaseRunResult> {
    return this.cases.run(id);
  }

  @Post('tester/cases/run-all/:workflowId')
  runAllCases(@Param('workflowId') workflowId: string): Promise<{ results: TestCaseRunResult[] }> {
    return this.cases.runAll(workflowId);
  }

  @Delete('tester/cases/:id')
  removeCase(@Param('id') id: string): Promise<{ id: string }> {
    return this.cases.remove(id);
  }

  @Get('test-runs')
  async list(@Query() query: RefineListQuery, @Res({ passthrough: true }) res: Response): Promise<TestRun[]> {
    const runs = await this.tester.list(
      query.workflowId,
      query.instanceId,
      toPrismaListArgs(query, 'startedAt'),
    );
    return withTotalCount(res, runs.length, runs);
  }

  @Get('test-runs/:id')
  async get(@Param('id') id: string): Promise<TestRun | null> {
    const runs = await this.tester.list();
    return runs.find((r) => r.id === id) ?? null;
  }

  @Post('tester/webhook/:workflowId')
  runWebhook(@Param('workflowId') workflowId: string, @Body() payload: unknown): Promise<TestRun> {
    return this.tester.runViaWebhook(workflowId, payload);
  }

  /** Ce qu'un test devrait bouchonner : nœuds qui sortent du système, pré-cochés. */
  @Get('tester/mock-plan/:workflowId')
  mockPlan(@Param('workflowId') workflowId: string): Promise<MockPlan> {
    return this.mockPlanner.plan(workflowId);
  }

  @Post('tester/mock/:workflowId')
  createMock(
    @Param('workflowId') workflowId: string,
    @Body()
    body: {
      nodeNames?: string[];
      pins?: Record<string, unknown[]>;
      stubSubWorkflows?: boolean;
    },
  ): Promise<MockedCopyResult> {
    return this.tester.createMockedCopy(workflowId, body);
  }

  /** Ce qui est parti dans un bouchon : les exécutions du workflow [BOUCHON]. */
  @Get('tester/stub-calls/:workflowId/:stubN8nId')
  stubCalls(@Param('workflowId') workflowId: string, @Param('stubN8nId') stubN8nId: string) {
    return this.tester.stubCalls(workflowId, stubN8nId);
  }

  /**
   * Ce que ferait un banc d'essai du nœud : ce qui partira pour de vrai, avec
   * quoi il sera nourri, et si la production l'interdit. Aucune écriture.
   */
  @Get('tester/node-bench/:workflowId')
  benchPreviewOf(
    @Param('workflowId') workflowId: string,
    @Query('node') nodeName: string,
    @Query('force') force?: string,
  ): Promise<NodeBenchPreview> {
    return this.benchPreview.preview(workflowId, nodeName, force === 'true');
  }

  /** Crée (ou réécrit) le banc, l'exécute, et le GARDE pour le debug. */
  @Post('tester/node-bench/:workflowId/run')
  runBench(@Param('workflowId') workflowId: string, @Body() body: RunBenchInput): Promise<BenchRunResult> {
    return this.bench.run(workflowId, body);
  }

  /** Les bancs existants d'une instance : lus dans n8n, seule source de ce qui existe. */
  @Get('tester/node-benches/:instanceId')
  listBenches(@Param('instanceId') instanceId: string): Promise<BenchSummary[]> {
    return this.bench.list(instanceId);
  }

  @Delete('tester/node-benches/:instanceId/:externalId')
  removeBench(
    @Param('instanceId') instanceId: string,
    @Param('externalId') externalId: string,
  ): Promise<{ externalId: string }> {
    return this.bench.remove(instanceId, externalId);
  }

  @Post('tester/fetch-last/:workflowId')
  fetchLast(@Param('workflowId') workflowId: string): Promise<TestRun> {
    return this.tester.fetchLastExecution(workflowId);
  }
}
