import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { N8nApiPort, PackageDocsPort, PackageReadme } from '@nwm/core';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { CommunityPackagesService } from '../src/infra/node-catalog/community-packages.service';
import { NodePackageDocsService } from '../src/infra/node-catalog/node-package-docs.service';
import { NodePackageDocsSyncService } from '../src/infra/node-catalog/node-package-docs-sync.service';
import { resetDb, testPrisma } from './helpers/db';
import { n8nWorkflow, seedInstance, seedWorkflow } from './helpers/workflow-fixtures';

/**
 * Le mode d'emploi des nœuds communautaires, contre une vraie base.
 *
 * Ce qui est tenu : le README servi est celui de la version INSTALLÉE, un README
 * déjà rangé n'est pas relu, la doc de l'équipe complète le README au lieu de
 * l'écraser, et l'assistant lit tout en base.
 */

const prisma = testPrisma() as unknown as PrismaService;
const FOO = 'n8n-nodes-foo';
const FOO_NODE = `${FOO}.foo`;

interface Registry {
  /** README par version ; la clé `latest` sert quand la version n'est pas gardée. */
  readmes: Record<string, string>;
  latest: string;
  calls: Array<string | undefined>;
}

function registry(): Registry {
  return { readmes: {}, latest: '2.0.0', calls: [] };
}

function source(reg: Registry): PackageDocsPort {
  return {
    async readme(packageName: string, version?: string): Promise<PackageReadme | null> {
      reg.calls.push(version);
      const exact = version ? reg.readmes[version] : undefined;
      const content = exact ?? reg.readmes[reg.latest];
      if (!content) return null;
      return { packageName, version: exact ? version : reg.latest, content, source: 'npm' };
    },
    async fetchDocument(url: string) {
      return `# Page\nLue depuis ${url}`;
    },
  };
}

function services(reg: Registry, installed: Array<{ packageName: string; installedVersion?: string }> = []) {
  const n8n = {
    async listCommunityPackages() {
      return installed;
    },
  } as unknown as N8nApiPort;
  const packages = new CommunityPackagesService(prisma, n8n);
  return {
    packages,
    docs: new NodePackageDocsService(prisma, packages, source(reg)),
    sync: new NodePackageDocsSyncService(prisma, packages, source(reg)),
  };
}

const CONFIG = { baseUrl: 'http://127.0.0.1:0', apiKey: 'k' };

describe('docs des paquets communautaires', () => {
  let instanceId: string;
  let reg: Registry;

  beforeEach(async () => {
    await resetDb();
    reg = registry();
    instanceId = await seedInstance(prisma);
    await seedWorkflow(
      prisma,
      instanceId,
      n8nWorkflow('wf1', 'Relances', {
        nodes: [{ name: 'Foo', type: FOO_NODE, parameters: {}, position: [0, 0] }],
      }),
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('relève un paquet employé par un workflow, même sans compte n8n', async () => {
    const { packages } = services(reg);

    expect(await packages.inUse()).toEqual([
      { packageName: FOO, instanceIds: [instanceId], versions: [], nodeTypes: [FOO_NODE] },
    ]);
  });

  it('lit le README de la version installée, puis ne le relit plus', async () => {
    reg.readmes['1.0.0'] = '# Foo 1\n## Credentials\nClé v1';
    reg.readmes['2.0.0'] = '# Foo 2';
    const { packages, sync, docs } = services(reg, [{ packageName: FOO, installedVersion: '1.0.0' }]);
    await packages.recordInstance(instanceId, CONFIG);

    expect(await sync.refreshAll()).toMatchObject({ fetched: 1 });
    expect(await sync.refreshAll()).toMatchObject({ fetched: 0, unchanged: 1 });
    expect(reg.calls).toEqual(['1.0.0']);

    const read = await docs.read(FOO_NODE, { instanceId, section: 'credentials' });
    expect(read?.text).toContain('Clé v1');
  });

  it('dit quand le README décrit une autre version que celle installée', async () => {
    reg.readmes['2.0.0'] = '# Foo 2\nUsage.';
    const { packages, sync, docs } = services(reg, [{ packageName: FOO, installedVersion: '1.0.0' }]);
    await packages.recordInstance(instanceId, CONFIG);
    await sync.refreshAll();

    const read = await docs.read(FOO_NODE, { instanceId });
    expect(read?.text).toContain('README npm 2.0.0 (installed: 1.0.0)');
  });

  it('sert la doc de l’équipe À CÔTÉ du README', async () => {
    reg.readmes['2.0.0'] = '# Foo\n## Opérations\nEnvoyer.';
    const { sync, docs } = services(reg);
    await sync.refreshAll();
    await docs.saveManual(FOO, { text: '## Pièges\nToujours passer le numéro en E.164.' }, 'a@b.fr');

    const index = await docs.read(FOO_NODE, { instanceId });
    expect(index?.text).toContain('Team doc');
    expect(index?.text).toContain('README npm 2.0.0');
    expect((await docs.read(FOO_NODE, { section: 'pièges' }))?.text).toContain('E.164');
    expect(await docs.announce({ nodes: [{ type: FOO_NODE }] }, instanceId)).toMatchObject([
      {
        packageName: FOO,
        docs: [
          { kind: 'manual', updatedBy: 'a@b.fr' },
          { kind: 'auto', version: '2.0.0' },
        ],
      },
    ]);
  });

  it('lit une adresse une seule fois, à l’enregistrement', async () => {
    const { docs } = services(reg);
    const saved = await docs.saveManual(FOO, { url: 'https://example.org/foo' });

    expect(saved).toMatchObject({ kind: 'manual', source: 'url', url: 'https://example.org/foo' });
    expect(await docs.content(FOO, 'manual')).toContain('Lue depuis https://example.org/foo');
  });

  it('refuse une doc manuelle vide', async () => {
    const { docs } = services(reg);
    await expect(docs.saveManual(FOO, { text: '  ' })).rejects.toThrow(/texte ou une adresse/);
  });

  it('rend null quand rien n’est enregistré : l’assistant doit le dire', async () => {
    const { docs } = services(reg);
    expect(await docs.read(FOO_NODE, { instanceId })).toBeNull();
  });

  it('retire le README d’une version désinstallée, jamais le dernier', async () => {
    reg.readmes['1.0.0'] = 'v1';
    reg.readmes['2.0.0'] = 'v2';
    const first = services(reg, [{ packageName: FOO, installedVersion: '1.0.0' }]);
    await first.packages.recordInstance(instanceId, CONFIG);
    await first.sync.refreshAll();

    const next = services(reg, [{ packageName: FOO, installedVersion: '2.0.0' }]);
    await next.packages.recordInstance(instanceId, CONFIG);
    await next.sync.refreshAll();

    const rows = await prisma.nodePackageDoc.findMany({ where: { packageName: FOO, kind: 'auto' } });
    expect(rows.map((row) => row.version)).toEqual(['2.0.0']);
  });
});
