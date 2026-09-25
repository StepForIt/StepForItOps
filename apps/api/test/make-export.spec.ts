import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { StoragePort, VcsPort } from '@nwm/core';
import { VersionExportService } from '../src/modules/versioning/version-export.service';
import { WorkflowExportService } from '../src/modules/workflows/workflow-export.service';
import { WorkflowsService } from '../src/modules/workflows/workflows.service';
import { WorkflowSyncService } from '../src/modules/workflows/workflow-sync.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { ModuleRegistryService } from '../src/infra/modules-registry/module-registry.service';
import { PlatformSettingsService } from '../src/infra/settings/platform-settings.service';
import { resetDb, testPrisma } from './helpers/db';

/**
 * Sortir un blueprint Make de la plateforme, contre une vraie base.
 *
 * Deux sorties, et elles ne passent pas par le même chemin. La sauvegarde vers
 * GitHub/Drive lit la table des versions et n'a jamais regardé la plateforme :
 * ces cas tiennent qu'un scénario y part tel quel, à la place qu'aurait un
 * workflow n8n, et part dans `archived/` quand Make ne le connaît plus. Le
 * bouton JSON, lui, passait par `getRaw()`, qui refuse tout ce qui n'est pas
 * n8n : c'est lui qui était fermé aux scénarios.
 */

const prisma = testPrisma() as unknown as PrismaService;

const blueprint = {
  name: 'Sync CRM',
  flow: [
    { id: 1, module: 'gateway:CustomWebHook', parameters: { __IMTHOOK__: 812 } },
    { id: 2, module: 'builtin:BasicRouter', routes: [{ flow: [{ id: 3, module: 'google-sheets:addRow' }] }] },
  ],
  metadata: { instant: true },
};

type Commit = { path: string; content: string; message: string };

/** Un VcsPort qui retient ses commits ; le reste n'est pas attendu. */
function recordingVcs(): VcsPort & { commits: Commit[] } {
  const commits: Commit[] = [];
  return {
    commits,
    async commitFile(_config: unknown, params: Commit) {
      commits.push(params);
      return {};
    },
    async deleteFile() {
      return { deleted: false };
    },
  } as unknown as VcsPort & { commits: Commit[] };
}

async function seedMakeScenario(extra: { missingUpstreamAt?: Date } = {}) {
  const instance = await prisma.instance.create({
    data: { name: 'Make Prod', baseUrl: 'eu1.make.com', apiKey: 'k', platform: 'make', zone: 'eu1.make.com' },
  });
  const workflow = await prisma.workflow.create({
    data: {
      instanceId: instance.id,
      externalId: '4210',
      name: 'Sync CRM',
      active: true,
      tags: [],
      hash: 'h1',
      raw: blueprint,
      ...extra,
    },
  });
  const version = await prisma.workflowVersion.create({
    data: { workflowId: workflow.id, hash: 'h1abcdef99', raw: blueprint, origin: 'sync' },
  });
  return { workflowId: workflow.id, versionId: version.id };
}

describe('sauvegarde GitHub d un scénario Make', () => {
  beforeEach(async () => {
    await resetDb();
    // `ExportTarget` ne référence aucune table vidée par `resetDb` : elle survivrait au cas précédent.
    await prisma.exportTarget.deleteMany();
    await prisma.exportTarget.create({
      data: { kind: 'github', name: 'Repo', config: { owner: 'acme', repo: 'backups', token: 't' } },
    });
  });

  afterAll(async () => {
    await prisma.exportTarget.deleteMany();
    await testPrisma().$disconnect();
  });

  it('écrit le blueprint tel quel, nommé par l id du scénario, et retient son emplacement', async () => {
    const { workflowId, versionId } = await seedMakeScenario();
    const vcs = recordingVcs();

    await new VersionExportService(prisma, {} as ModuleRegistryService, vcs, {} as StoragePort).exportVersion(
      versionId,
    );

    expect(vcs.commits).toHaveLength(1);
    expect(vcs.commits[0].path).toBe('workflows/make-prod/sync-crm--4210.json');
    expect(JSON.parse(vcs.commits[0].content)).toEqual(blueprint);
    expect(vcs.commits[0].message).toBe('chore(make): Sync CRM @ h1abcdef');
    const ref = await prisma.workflowExportRef.findFirst({ where: { workflowId } });
    expect(ref?.path).toBe('workflows/make-prod/sync-crm--4210.json');
  });

  it('range dans archived/ un scénario que Make ne connaît plus', async () => {
    const { versionId } = await seedMakeScenario({ missingUpstreamAt: new Date() });
    const vcs = recordingVcs();

    await new VersionExportService(prisma, {} as ModuleRegistryService, vcs, {} as StoragePort).exportVersion(
      versionId,
    );

    expect(vcs.commits[0].path).toBe('workflows/archived/make-prod/sync-crm--4210.json');
  });
});

describe('export JSON d un scénario Make', () => {
  beforeEach(async () => {
    await resetDb();
  });

  function exportService(sync: Partial<WorkflowSyncService>): WorkflowExportService {
    const settings = {
      declaredEnvIds: async () => ['dev', 'preprod', 'prod'],
    } as unknown as PlatformSettingsService;
    return new WorkflowExportService(new WorkflowsService(prisma, settings, sync as WorkflowSyncService));
  }

  it('rend le blueprint après l avoir redemandé à Make, modules comptés', async () => {
    const { workflowId } = await seedMakeScenario();
    const synced: string[] = [];

    const result = await exportService({
      syncWorkflow: async (id: string) => {
        synced.push(id);
        return { name: 'Sync CRM', changed: false, missing: false };
      },
    }).export(workflowId);

    expect(synced).toEqual([workflowId]);
    expect(result.platform).toBe('make');
    expect(JSON.parse(result.json)).toEqual(blueprint);
    expect(result.fileName).toBe('sync-crm.blueprint.json');
    expect(result.nodeCount).toBe(3);
    expect(result.hasPinData).toBe(false);
    expect(result.stale).toBe(false);
  });

  it('retombe sur la copie locale en le disant quand Make ne répond pas', async () => {
    const { workflowId } = await seedMakeScenario();

    const result = await exportService({
      syncWorkflow: async () => {
        throw new Error('Make injoignable');
      },
    }).export(workflowId);

    expect(result.stale).toBe(true);
    expect(JSON.parse(result.json)).toEqual(blueprint);
  });
});
