import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { EventBusService } from '../src/infra/events/event-bus.service';
import { ModuleRegistryService } from '../src/infra/modules-registry/module-registry.service';
import { WorkflowSyncService } from '../src/modules/workflows/workflow-sync.service';
import { ConfigExportService } from '../src/modules/config-transfer/config-export.service';
import { ConfigImportService } from '../src/modules/config-transfer/config-import.service';
import { ConfigImportSyncService } from '../src/modules/config-transfer/config-import-sync.service';
import { ConfigImportWorkflowScopedService } from '../src/modules/config-transfer/config-import-workflow-scoped.service';
import { WorkflowRefResolver } from '../src/modules/config-transfer/workflow-ref.resolver';
import { ConfigBundle } from '../src/modules/config-transfer/config-bundle.types';
import { ExportKey } from '../src/infra/secrets/export-key';
import { recordingBus } from './helpers/fakes';
import { resetDb, testPrisma } from './helpers/db';

/**
 * Export puis import sur une base vierge : l'instance revient telle qu'elle
 * était (plateforme comprise), et ce qui vise un workflow se rattache en UNE
 * passe — l'import synchronise l'instance au lieu de demander un second import.
 */

const prisma = testPrisma() as unknown as PrismaService;
const EXPORT_KEY = 'cheval-agrafe-batterie';

/** Une synchro qui « découvre » les workflows donnés, comme le ferait n8n. */
function fakeSync(externalIds: string[]): WorkflowSyncService & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async syncInstance(instanceId: string) {
      calls.push(instanceId);
      for (const externalId of externalIds) {
        await prisma.workflow.create({
          data: { instanceId, externalId, name: `WF ${externalId}`, hash: 'h', raw: {} },
        });
      }
      return { synced: externalIds.length, changed: externalIds.length, recovered: 0, missing: 0 };
    },
  } as unknown as WorkflowSyncService & { calls: string[] };
}

function importer(sync: WorkflowSyncService): ConfigImportService {
  const refs = new WorkflowRefResolver(prisma);
  const registry = {
    listManifests: () => [],
    isEnabled: async () => true,
    setEnabled: async () => undefined,
  } as unknown as ModuleRegistryService;
  return new ConfigImportService(
    prisma,
    recordingBus() as unknown as EventBusService,
    registry,
    refs,
    new ConfigImportWorkflowScopedService(prisma, refs),
    new ConfigImportSyncService(prisma, sync, refs),
  );
}

async function sourceBundle(): Promise<ConfigBundle> {
  const client = await prisma.client.create({ data: { name: 'Acme' } });
  const make = await prisma.instance.create({
    data: {
      name: 'Make EU',
      baseUrl: 'https://eu1.make.com',
      apiKey: 'tok',
      platform: 'make',
      zone: 'eu1.make.com',
      externalOrgId: '42',
      externalTeamId: '7',
      clientId: client.id,
    },
  });
  const wf = await prisma.workflow.create({
    data: { instanceId: make.id, externalId: '100', name: 'Facturation', hash: 'h', raw: {} },
  });
  await prisma.monitor.create({
    data: { name: 'Beat', kind: 'heartbeat', token: 'tk-1', workflowId: wf.id },
  });
  await prisma.findingIgnore.create({
    data: { workflowId: wf.id, module: 'verifier', code: 'x', reason: 'ok' },
  });
  const bundle = await new ConfigExportService(prisma).buildBundle(true, EXPORT_KEY);
  await resetDb();
  await prisma.client.deleteMany();
  return bundle;
}

beforeEach(async () => {
  await resetDb();
  await prisma.client.deleteMany();
});

afterAll(async () => {
  await resetDb();
  await prisma.client.deleteMany();
});

describe('config-transfer', () => {
  it("l'export emporte la plateforme et le périmètre Make, et l'import les restaure", async () => {
    const bundle = await sourceBundle();
    expect(bundle.instances[0]).toMatchObject({ platform: 'make', zone: 'eu1.make.com', client: 'Acme' });

    await importer(fakeSync(['100'])).importBundle(bundle, 'merge', false, EXPORT_KEY);

    const instance = await prisma.instance.findFirstOrThrow({ include: { client: true } });
    expect(instance).toMatchObject({
      platform: 'make',
      zone: 'eu1.make.com',
      externalOrgId: '42',
      externalTeamId: '7',
    });
    expect(instance.client?.name).toBe('Acme');
  });

  it("sur une base vierge, l'import synchronise puis rattache les workflows en une passe", async () => {
    const bundle = await sourceBundle();
    const sync = fakeSync(['100']);

    const report = await importer(sync).importBundle(bundle, 'merge', false, EXPORT_KEY);

    expect(sync.calls).toHaveLength(1);
    expect(report.syncs).toEqual([{ instance: 'Make EU', synced: 1 }]);
    expect(report.warnings).toEqual([]);
    const wf = await prisma.workflow.findFirstOrThrow();
    expect((await prisma.monitor.findUniqueOrThrow({ where: { token: 'tk-1' } })).workflowId).toBe(wf.id);
    expect(await prisma.findingIgnore.count({ where: { workflowId: wf.id } })).toBe(1);
  });

  it('la prévisualisation annonce la synchro sans rien écrire ni crier au workflow manquant', async () => {
    const bundle = await sourceBundle();
    const sync = fakeSync(['100']);

    const report = await importer(sync).importBundle(bundle, 'merge', true, EXPORT_KEY);

    expect(sync.calls).toHaveLength(0);
    expect(report.syncs).toEqual([{ instance: 'Make EU', synced: null }]);
    expect(report.warnings).toEqual([]);
    expect(report.sections.findingIgnores.created).toBe(1);
    expect(await prisma.instance.count()).toBe(0);
  });

  it("un workflow que l'instance ne sert plus reste signalé", async () => {
    const bundle = await sourceBundle();

    const report = await importer(fakeSync([])).importBundle(bundle, 'merge', false, EXPORT_KEY);

    expect(report.warnings.some((w) => w.includes('100'))).toBe(true);
    expect(report.sections.findingIgnores.skipped).toBe(1);
  });
});

/**
 * La clé d'export : un fichier avec secrets ne les porte que scellés par une
 * phrase donnée à l'export et redemandée à l'import — jamais `SECRETS_KEY`.
 */
describe("config-transfer — clé d'export", () => {
  async function clearSettings(): Promise<void> {
    await prisma.exportTarget.deleteMany();
    await prisma.monitoringSettings.deleteMany();
    await prisma.aiSettings.deleteMany();
  }
  beforeEach(clearSettings);
  afterAll(clearSettings);

  async function secretSource(): Promise<void> {
    await prisma.instance.create({
      data: {
        name: 'Prod',
        baseUrl: 'https://n8n.example.test',
        apiKey: 'api-secret',
        n8nEmail: 'owner@example.test',
        n8nPassword: 'owner-secret',
      },
    });
    await prisma.exportTarget.create({
      data: { kind: 'github', name: 'Repo', config: { repo: 'org/repo', token: 'gh-secret' } },
    });
    await prisma.monitoringSettings.create({
      data: { id: 'default', kumaUrl: 'https://kuma.test', kumaUsername: 'u', kumaPassword: 'kuma-secret' },
    });
    await prisma.aiSettings.create({ data: { id: 'anthropic', apiKey: 'ai-secret', active: true } });
  }

  it('scelle chaque secret : rien ne se lit en clair dans le fichier', async () => {
    await secretSource();
    const bundle = await new ConfigExportService(prisma).buildBundle(true, EXPORT_KEY);

    const file = JSON.stringify(bundle);
    for (const secret of ['api-secret', 'owner-secret', 'gh-secret', 'kuma-secret', 'ai-secret']) {
      expect(file).not.toContain(secret);
    }
    expect(bundle.sealed?.kdf).toBe('scrypt');
    expect(ExportKey.isSealed(bundle.instances[0].apiKey)).toBe(true);
    expect(bundle.exportTargets[0].config.repo).toBe('org/repo');
  });

  it("refuse d'exporter les secrets sans clé, ou avec une clé trop courte", async () => {
    await secretSource();
    const exporter = new ConfigExportService(prisma);
    await expect(exporter.buildBundle(true)).rejects.toThrow(/clé d'export|export key/i);
    await expect(exporter.buildBundle(true, 'court')).rejects.toThrow(/12/);
    const plain = await exporter.buildBundle(false);
    expect(plain.sealed).toBeUndefined();
    expect(plain.instances[0].apiKey).toBeNull();
  });

  it("l'import rouvre les secrets avec la même clé", async () => {
    await secretSource();
    const bundle = await new ConfigExportService(prisma).buildBundle(true, EXPORT_KEY);
    await resetDb();
    await clearSettings();

    await importer(fakeSync([])).importBundle(bundle, 'merge', false, EXPORT_KEY);

    const instance = await prisma.instance.findFirstOrThrow();
    expect(instance).toMatchObject({ apiKey: 'api-secret', n8nPassword: 'owner-secret' });
    const target = await prisma.exportTarget.findFirstOrThrow();
    expect(target.config).toMatchObject({ repo: 'org/repo', token: 'gh-secret' });
    expect((await prisma.monitoringSettings.findFirstOrThrow()).kumaPassword).toBe('kuma-secret');
    expect((await prisma.aiSettings.findFirstOrThrow()).apiKey).toBe('ai-secret');
  });

  it("sans la clé, ou avec une autre, l'import refuse avant d'écrire quoi que ce soit", async () => {
    await secretSource();
    const bundle = await new ConfigExportService(prisma).buildBundle(true, EXPORT_KEY);
    await resetDb();

    const svc = importer(fakeSync([]));
    await expect(svc.importBundle(bundle, 'merge', true)).rejects.toThrow(/clé d'export|export key/i);
    await expect(svc.importBundle(bundle, 'merge', false, 'une-autre-cle-longue')).rejects.toThrow(
      /clé d'export|export key/i,
    );
    expect(await prisma.instance.count()).toBe(0);
  });

  it("un ancien fichier, secrets en clair, s'importe toujours sans clé", async () => {
    await secretSource();
    const sealed = await new ConfigExportService(prisma).buildBundle(true, EXPORT_KEY);
    const key = ExportKey.open(sealed.sealed!, EXPORT_KEY);
    const legacy: ConfigBundle = {
      ...sealed,
      sealed: undefined,
      instances: sealed.instances.map((i) => ({ ...i, apiKey: key.unseal(i.apiKey!) })),
    };
    await resetDb();

    await importer(fakeSync([])).importBundle(legacy, 'merge', false);

    expect((await prisma.instance.findFirstOrThrow()).apiKey).toBe('api-secret');
  });
});
