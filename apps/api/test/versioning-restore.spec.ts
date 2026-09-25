import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MAKE_CAPABILITIES,
  N8N_CAPABILITIES,
  N8nApiPort,
  PlatformId,
  WorkflowPlatformPort,
  WorkflowPlatformPorts,
} from '@nwm/core';
import { VersioningService } from '../src/modules/versioning/versioning.service';
import { VersionPreviewService } from '../src/modules/versioning/version-preview.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { EventBusService } from '../src/infra/events/event-bus.service';
import { ModuleRegistryService } from '../src/infra/modules-registry/module-registry.service';
import { InstancesService } from '../src/modules/instances/instances.service';
import { PlatformSettingsService } from '../src/infra/settings/platform-settings.service';
import { EnvChainGuardService } from '../src/infra/settings/env-chain-guard.service';
import { recordingBus } from './helpers/fakes';
import { n8nWorkflow } from './helpers/workflow-fixtures';
import {
  WorkflowLockService,
  WorkflowLockedException,
} from '../src/infra/workflow-lock/workflow-lock.service';
import { runWithLockContext } from '../src/infra/workflow-lock/lock-context';
import { resetDb, testPrisma } from './helpers/db';

/**
 * La restauration d'une version, contre une vraie base.
 *
 * `createVersion` stocke le contenu de toutes les plateformes sans le lire ; la
 * restauration le réécrit par le port de la plateforme du workflow. Ce qui se
 * tient ici : une version part vers SA plateforme et jamais vers l'autre, telle
 * qu'elle a été sauvegardée, et le preview parle le vocabulaire de cette
 * plateforme — un scénario Make ne se juge pas sur des `nodes` qu'il n'a pas.
 */

const prisma = testPrisma() as unknown as PrismaService;

type RecordingPort = WorkflowPlatformPort & { writes: Array<{ externalId: string; raw: unknown }> };

/** Un port qui retient ses écritures ; toute autre méthode échoue en se nommant. */
function recordingPort(platform: PlatformId): RecordingPort {
  const writes: Array<{ externalId: string; raw: unknown }> = [];
  const port = {
    platform,
    writes,
    capabilities: () => (platform === 'make' ? MAKE_CAPABILITIES : N8N_CAPABILITIES),
    async updateWorkflow(_instance: unknown, externalId: string, raw: unknown) {
      writes.push({ externalId, raw });
    },
  };
  return new Proxy(port, {
    get(target, key) {
      if (key in target) return target[key as keyof typeof target];
      if (typeof key === 'symbol') return undefined;
      throw new Error(`${platform}.${String(key)} n'est pas attendu dans ce test`);
    },
  }) as unknown as RecordingPort;
}

function makeService(ports: WorkflowPlatformPorts): VersioningService {
  const envChain = { async assertDirectWriteAllowed() {} } as unknown as EnvChainGuardService;
  return new VersioningService(
    prisma,
    recordingBus() as unknown as EventBusService,
    {} as ModuleRegistryService,
    new InstancesService(prisma, {} as N8nApiPort, ports),
    {} as PlatformSettingsService,
    envChain,
    new WorkflowLockService(prisma),
  );
}

async function seedVersion(
  platform: PlatformId,
  current: unknown,
  restored: unknown,
): Promise<{ versionId: string; workflowId: string }> {
  const instance = await prisma.instance.create({
    data: { name: platform, baseUrl: 'http://127.0.0.1:0', apiKey: 'k', platform, zone: 'eu1.make.com' },
  });
  const workflow = await prisma.workflow.create({
    data: {
      instanceId: instance.id,
      externalId: '42',
      name: 'Facturation',
      active: false,
      tags: [],
      hash: 'h-current',
      raw: current as object,
    },
  });
  const version = await prisma.workflowVersion.create({
    data: { workflowId: workflow.id, hash: 'h-old', raw: restored as object, origin: 'sync' },
  });
  return { versionId: version.id, workflowId: workflow.id };
}

const blueprint = (flow: unknown[], name = 'Facturation') => ({ name, flow, metadata: {} });
const module = (id: number, parameters: Record<string, unknown> = {}) => ({
  id,
  module: 'http:ActionSendData',
  version: 3,
  parameters,
});

describe('VersioningService.restore', () => {
  let ports: { n8n: RecordingPort; make: RecordingPort };

  beforeEach(async () => {
    await resetDb();
    ports = { n8n: recordingPort('n8n'), make: recordingPort('make') };
  });

  afterAll(async () => {
    await testPrisma().$disconnect();
  });

  it('réécrit une version Make par le port Make, blueprint tel que sauvegardé', async () => {
    const restored = blueprint([module(1), module(2)]);
    const { versionId, workflowId } = await seedVersion('make', blueprint([module(1)]), restored);

    await makeService(ports).restore(versionId);

    expect(ports.make.writes).toEqual([{ externalId: '42', raw: restored }]);
    expect(ports.n8n.writes).toEqual([]);
    const origins = await prisma.workflowVersion.findMany({
      where: { workflowId },
      select: { origin: true },
    });
    expect(origins.map((row) => row.origin).sort()).toEqual(['restore', 'sync']);
  });

  it('réécrit une version n8n par le port n8n', async () => {
    const raw = n8nWorkflow('42', 'Facturation');
    const { versionId } = await seedVersion('n8n', raw, raw);

    await makeService(ports).restore(versionId);

    expect(ports.n8n.writes).toEqual([{ externalId: '42', raw }]);
    expect(ports.make.writes).toEqual([]);
  });

  it('refuse de restaurer un exemplaire verrouillé, sans rien écrire', async () => {
    const raw = n8nWorkflow('42', 'Facturation');
    const { versionId, workflowId } = await seedVersion('n8n', raw, raw);
    await new WorkflowLockService(prisma).lock(workflowId);

    await expect(makeService(ports).restore(versionId)).rejects.toBeInstanceOf(WorkflowLockedException);
    expect(ports.n8n.writes).toEqual([]);
  });

  it('restaure un exemplaire verrouillé quand le forçage le nomme, et le journalise', async () => {
    const raw = n8nWorkflow('42', 'Facturation');
    const { versionId, workflowId } = await seedVersion('n8n', raw, raw);
    await new WorkflowLockService(prisma).lock(workflowId);

    await runWithLockContext(
      {
        override: { workflowIds: [workflowId], reason: 'retour arrière validé' },
        action: 'POST /versions/x/restore',
      },
      () => makeService(ports).restore(versionId),
    );

    expect(ports.n8n.writes).toHaveLength(1);
    expect(await prisma.workflowLockOverride.count({ where: { workflowId } })).toBe(1);
  });

  it('refuse une plateforme qu aucun adapter ne sert, sans rien écrire', async () => {
    const { versionId, workflowId } = await seedVersion('make', blueprint([]), blueprint([]));

    await expect(makeService({ n8n: ports.n8n }).restore(versionId)).rejects.toThrow(/non gérée/);
    expect(await prisma.workflowVersion.count({ where: { workflowId } })).toBe(1);
  });
});

describe('VersionPreviewService.restorePreview', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('compte les modules d un scénario Make et annonce ce qui ne sera pas restauré', async () => {
    const current = blueprint([module(1, { __IMTCONN__: 11 })]);
    const restored = blueprint(
      [module(1, { __IMTCONN__: 11 }), module(2, { __IMTCONN__: 42 })],
      'Ancien nom',
    );
    const { versionId } = await seedVersion('make', current, restored);

    const preview = await new VersionPreviewService(prisma).restorePreview(versionId);

    expect(preview.platform).toBe('make');
    expect(preview.nodes).toMatchObject({ current: 1, restored: 2 });
    expect(preview.renameTo).toBe('Ancien nom');
    expect(preview.archived).toBe(false);
    expect(preview.notes.join(' ')).toMatch(/planning/);
    expect(preview.notes.join(' ')).toMatch(/connexion #42/);
  });

  it('garde le calcul n8n inchangé, sans note', async () => {
    const current = n8nWorkflow('42', 'Facturation');
    const restored = n8nWorkflow('42', 'Facturation', {
      nodes: [
        ...current.nodes,
        { name: 'Slack', type: 'n8n-nodes-base.slack', parameters: {}, position: [200, 0] },
      ],
    });
    const { versionId } = await seedVersion('n8n', current, restored);

    const preview = await new VersionPreviewService(prisma).restorePreview(versionId);

    expect(preview.platform).toBe('n8n');
    expect(preview.nodes.added).toEqual(['Slack']);
    expect(preview.notes).toEqual([]);
  });
});
