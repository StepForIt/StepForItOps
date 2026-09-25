import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { N8nWorkflow, RemoteSchemaReport } from '@nwm/core';
import { RemoteSchemaService } from '../src/modules/remote-schema/remote-schema.service';
import { RemoteSchemaCheckService } from '../src/infra/remote-schema/remote-schema-check.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { PlatformSettingsService } from '../src/infra/settings/platform-settings.service';
import { CheckProfilesService } from '../src/infra/check-profiles/check-profiles.service';
import { FindingIgnoreService } from '../src/modules/workflows/finding-ignore.service';
import { WorkflowsService } from '../src/modules/workflows/workflows.service';
import { InstancesService } from '../src/modules/instances/instances.service';
import { resetDb, testPrisma } from './helpers/db';

/**
 * Ce que le contrôle lancé depuis la page d'un workflow PERSISTE : ses
 * findings remplacent les précédents du module, les règles d'exclusion et
 * les contrôles décochés passent avant l'écriture.
 */

const prisma = testPrisma() as unknown as PrismaService;

const report: RemoteSchemaReport = {
  tables: [],
  unlocatable: [],
  findings: [
    {
      severity: 'error',
      code: 'remote-column-missing',
      message: 'La colonne « Segment » que ce nœud écrit n’existe pas dans « Leads »',
      nodeName: 'Créer lead',
      data: { column: 'Segment', via: 'Préparer' },
    },
  ],
};

async function setup() {
  const instance = await prisma.instance.create({
    data: { name: 'Dev', baseUrl: 'http://dev', apiKey: 'k' },
  });
  const raw: N8nWorkflow = { id: '1', name: 'Leads', nodes: [], connections: {} };
  const workflow = await prisma.workflow.create({
    data: {
      instanceId: instance.id,
      externalId: '1',
      name: 'Leads',
      active: false,
      tags: [],
      hash: 'h',
      raw: raw as object,
    },
  });
  const settings = new PlatformSettingsService(prisma);
  const checks: Array<{ keepOnError?: boolean }> = [];
  const service = new RemoteSchemaService(
    prisma,
    {
      async getRaw() {
        return { workflow, raw };
      },
    } as unknown as WorkflowsService,
    {
      async getConfig() {
        return { baseUrl: 'http://dev', apiKey: 'k' };
      },
    } as unknown as InstancesService,
    new FindingIgnoreService(prisma, settings),
    new CheckProfilesService(prisma, settings),
    {
      async check(_config: unknown, _workflow: unknown, options: { keepOnError?: boolean }) {
        checks.push(options);
        return report;
      },
    } as unknown as RemoteSchemaCheckService,
  );
  return { service, workflowId: workflow.id, checks };
}

describe('RemoteSchemaService — persistance des findings', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('remplace les findings du module et garde la sonde en cas d’échec (lancé par un humain)', async () => {
    const { service, workflowId, checks } = await setup();
    await prisma.finding.create({
      data: {
        workflowId,
        module: 'remote-schema',
        severity: 'error',
        code: 'remote-table-missing',
        message: 'ancien',
      },
    });

    const result = await service.run(workflowId);

    expect(checks).toEqual([{ keepOnError: true }]);
    expect(result.findings.map((finding) => finding.code)).toEqual(['remote-column-missing']);
    const stored = await prisma.finding.findMany({ where: { workflowId } });
    expect(stored).toHaveLength(1);
    expect(stored[0].data).toMatchObject({ via: 'Préparer' });
  });

  it('un contrôle décoché n’est pas persisté ; tout décoché, aucune sonde', async () => {
    const { service, workflowId, checks } = await setup();

    expect((await service.run(workflowId, ['remote-column-missing'])).findings).toEqual([]);
    expect(checks).toHaveLength(1);

    await service.run(workflowId, ['remote-column-missing', 'remote-table-missing']);
    expect(checks).toHaveLength(1);
  });
});
