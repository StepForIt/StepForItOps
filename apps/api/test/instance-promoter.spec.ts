import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ENVS, N8nApiPort, N8nWorkflow } from '@nwm/core';
import { InstancePromoterService, PromoteInput } from '../src/modules/env-switcher/instance-promoter.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { WorkflowsService } from '../src/modules/workflows/workflows.service';
import { WorkflowSyncService } from '../src/modules/workflows/workflow-sync.service';
import { InstancesService } from '../src/modules/instances/instances.service';
import { PlatformSettingsService } from '../src/infra/settings/platform-settings.service';
import { VersionProposalService } from '../src/modules/env-switcher/version-proposal.service';
import { ReleaseStateService } from '../src/modules/env-switcher/release-state.service';
import { ModuleRegistryService } from '../src/infra/modules-registry/module-registry.service';
import { RemoteSchemaCheckService } from '../src/infra/remote-schema/remote-schema-check.service';
import { RemoteSchemaReaderService } from '../src/infra/remote-schema/remote-schema-reader.service';
import { N8nProbeService } from '../src/infra/n8n-probe/n8n-probe.service';
import {
  WorkflowLockService,
  WorkflowLockedException,
} from '../src/infra/workflow-lock/workflow-lock.service';
import { runWithLockContext } from '../src/infra/workflow-lock/lock-context';
import { PromotionPublishService } from '../src/modules/env-switcher/promotion-publish.service';
import { resetDb, testPrisma } from './helpers/db';

/**
 * Les quality gates de la promotion.
 *
 * C'est l'endroit où la plateforme dit non, et la nuance qui compte n'est pas
 * « bloqué / pas bloqué » mais **contournable ou pas** : un finding error se
 * force par une case cochée, une contrepartie ARCHIVÉE ne se force pas — n8n
 * refuse toute écriture dessus, donc passer outre ne produirait qu'un échec
 * plus tard, sur un workflow que plus rien n'exécute. Les deux se ressemblent
 * dans le preview (`blockers`), et seul `forceable` les distingue.
 */

const prisma = testPrisma() as unknown as PrismaService;

function n8nWorkflow(id: string, name: string, extra: Partial<N8nWorkflow> = {}): N8nWorkflow {
  return { id, name, nodes: [], connections: {}, active: false, ...extra } as N8nWorkflow;
}

/** Un nœud qui porte une credential : c'est ce que le gate credentials regarde. */
function nodeWithCredential(name: string, credential: string) {
  return {
    name,
    type: 'n8n-nodes-base.airtable',
    parameters: {},
    credentials: { airtableTokenApi: { id: '1', name: credential } },
  } as never;
}

interface Fixture {
  service: InstancePromoterService;
  sourceWorkflowId: string;
  targetInstanceId: string;
  /** Ce que la cible expose : le test le réécrit avant d'appeler `preview`. */
  remote: N8nWorkflow[];
  /** Réponse de la sonde des tables distantes, et les corps d'appel reçus. */
  webhook: (payload: Record<string, unknown>) => unknown;
  probeCalls: Array<Record<string, unknown>>;
  /** Écritures vers n8n, dans l'ordre : `create` pour une création, l'id n8n sinon. */
  writes: Array<{ id: string; workflow: N8nWorkflow }>;
}

async function setup(source: N8nWorkflow, remote: N8nWorkflow[]): Promise<Fixture> {
  const dev = await prisma.instance.create({ data: { name: 'Dev', baseUrl: 'http://dev', apiKey: 'k' } });
  const prod = await prisma.instance.create({ data: { name: 'Prod', baseUrl: 'http://prod', apiKey: 'k' } });
  const workflow = await prisma.workflow.create({
    data: {
      instanceId: dev.id,
      externalId: String(source.id),
      name: source.name,
      active: false,
      tags: [],
      hash: 'h',
      raw: source as unknown as object,
    },
  });

  const n8n = {
    async listWorkflows() {
      return fixture.remote;
    },
    async createWorkflow(_config: unknown, workflow: N8nWorkflow) {
      fixture.writes.push({ id: 'create', workflow });
      return { id: 'probe' };
    },
    async updateWorkflow(_config: unknown, id: string, workflow: N8nWorkflow) {
      fixture.writes.push({ id, workflow });
      return workflow;
    },
    async publishWorkflow(_config: unknown, id: string) {
      fixture.writes.push({ id: `publish:${id}`, workflow: n8nWorkflow(id, id) });
    },
    async activateWorkflow(_config: unknown, id: string) {
      fixture.writes.push({ id: `activate:${id}`, workflow: n8nWorkflow(id, id) });
    },
    async deleteWorkflow() {},
    async callWebhook(_config: unknown, _path: string, payload: Record<string, unknown>) {
      fixture.probeCalls.push(payload);
      return fixture.webhook(payload);
    },
    async getWorkflow(_config: unknown, externalId: string) {
      return (
        fixture.remote.find((candidate) => String(candidate.id) === externalId) ??
        (String(source.id) === externalId ? source : n8nWorkflow(externalId, externalId))
      );
    },
  } as unknown as N8nApiPort;

  const workflows = {
    async getRaw(id: string) {
      const row = await prisma.workflow.findUniqueOrThrow({ where: { id } });
      return { workflow: row, raw: row.raw as unknown as N8nWorkflow };
    },
  } as unknown as WorkflowsService;
  const sync = {
    async upsertWorkflow() {
      return {};
    },
  } as unknown as WorkflowSyncService;
  const instances = {
    async getConfig() {
      return { baseUrl: 'http://n8n', apiKey: 'k' };
    },
  } as unknown as InstancesService;
  const settings = {
    async get() {
      return { envs: DEFAULT_ENVS, envChainMode: 'warn' };
    },
    async declaredEnvs() {
      return DEFAULT_ENVS;
    },
    async declaredEnvIds() {
      return DEFAULT_ENVS.map((env) => env.id);
    },
  } as unknown as PlatformSettingsService;
  const versions = {
    async propose() {
      return { level: 'patch', reason: 'règle déterministe', source: 'rules' };
    },
  } as unknown as VersionProposalService;
  const release = {
    async of() {
      return { state: 'unreleased', version: null };
    },
  } as unknown as ReleaseStateService;

  const fixture: Fixture = {
    service: new InstancePromoterService(
      prisma,
      workflows,
      sync,
      instances,
      settings,
      versions,
      release,
      n8n,
      {
        async isEnabled() {
          return true;
        },
      } as unknown as ModuleRegistryService,
      new RemoteSchemaCheckService(new RemoteSchemaReaderService(prisma, new N8nProbeService(n8n))),
      new WorkflowLockService(prisma),
      new PromotionPublishService(prisma, sync, instances, n8n, new WorkflowLockService(prisma)),
    ),
    sourceWorkflowId: workflow.id,
    targetInstanceId: prod.id,
    remote,
    webhook: () => {
      throw new Error('sonde non attendue');
    },
    probeCalls: [],
    writes: [],
  };
  return fixture;
}

const toProd: Omit<PromoteInput, 'targetInstanceId'> = { targetEnv: 'prod' };

describe('InstancePromoterService — les gates du preview', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('laisse passer une promotion propre', async () => {
    const fixture = await setup(n8nWorkflow('1', 'Facturation - DEV'), []);

    const preview = await fixture.service.preview(fixture.sourceWorkflowId, {
      ...toProd,
      targetInstanceId: fixture.targetInstanceId,
    });

    expect(preview.blockers).toEqual([]);
    expect(preview.mode).toBe('create');
    expect(preview.targetName).toBe('Facturation - PROD');
    expect(preview.gates.findings.ok).toBe(true);
    // Aucun cas de test enregistré : le gate n'existe pas, il ne « passe » pas.
    expect(preview.gates.tests).toBeNull();
    // dev → prod saute la preprod déclarée : c'est la seule chose à décider.
    expect(preview.readiness.decisions.map((decision) => decision.code)).toEqual(['confirm-skip']);
  });

  it('est prête d’office quand elle traverse la chaîne et que rien n’est au rouge', async () => {
    const fixture = await setup(n8nWorkflow('1', 'Facturation - DEV'), []);

    const preview = await fixture.service.preview(fixture.sourceWorkflowId, {
      ...toProd,
      throughChain: true,
      targetInstanceId: fixture.targetInstanceId,
    });

    // Rien d'écrasé, rien au rouge : un lot l'applique sans rien demander.
    expect(preview.readiness).toEqual({ status: 'ready', decisions: [], reasons: [] });
  });

  it('bloque sur un finding error, mais laisse la case force ouverte', async () => {
    const fixture = await setup(n8nWorkflow('1', 'Facturation - DEV'), []);
    await prisma.finding.create({
      data: {
        workflowId: fixture.sourceWorkflowId,
        module: 'verifier',
        severity: 'error',
        code: 'loop-wiring',
        message: 'la branche loop ne se referme pas sur le nœud',
        nodeName: 'Loop Over Items',
      },
    });

    const preview = await fixture.service.preview(fixture.sourceWorkflowId, {
      ...toProd,
      targetInstanceId: fixture.targetInstanceId,
    });

    expect(preview.gates.findings.ok).toBe(false);
    expect(preview.blockers.join(' ')).toContain('finding');
    // Contournable : c'est un jugement de la plateforme, pas un refus de n8n.
    expect(preview.forceable).toBe(true);
    expect(preview.gates.findings.items[0]?.nodeName).toBe('Loop Over Items');
    expect(preview.readiness.status).toBe('decide');
    expect(preview.readiness.decisions.map((decision) => decision.code)).toEqual(['force', 'confirm-skip']);
  });

  it('ignore un finding déjà résolu', async () => {
    const fixture = await setup(n8nWorkflow('1', 'Facturation - DEV'), []);
    await prisma.finding.create({
      data: {
        workflowId: fixture.sourceWorkflowId,
        module: 'verifier',
        severity: 'error',
        code: 'loop-wiring',
        message: 'corrigé depuis',
        resolvedAt: new Date(),
      },
    });

    const preview = await fixture.service.preview(fixture.sourceWorkflowId, {
      ...toProd,
      targetInstanceId: fixture.targetInstanceId,
    });

    expect(preview.gates.findings.ok).toBe(true);
    expect(preview.blockers).toEqual([]);
  });

  it('bloque sur un test rouge, et compte ceux qui n’ont jamais tourné', async () => {
    const fixture = await setup(n8nWorkflow('1', 'Facturation - DEV'), []);
    await prisma.testCase.createMany({
      data: [
        { workflowId: fixture.sourceWorkflowId, name: 'nominal', expected: {}, lastStatus: 'passed' },
        { workflowId: fixture.sourceWorkflowId, name: 'sans client', expected: {}, lastStatus: 'failed' },
        { workflowId: fixture.sourceWorkflowId, name: 'jamais joué', expected: {} },
      ],
    });

    const preview = await fixture.service.preview(fixture.sourceWorkflowId, {
      ...toProd,
      targetInstanceId: fixture.targetInstanceId,
    });

    expect(preview.gates.tests).toMatchObject({ ok: false, total: 3, passed: 1, failed: 1, neverRun: 1 });
    expect(preview.blockers.join(' ')).toContain('test');
    expect(preview.forceable).toBe(true);
  });

  it('ne compte pas un cas de test désactivé', async () => {
    const fixture = await setup(n8nWorkflow('1', 'Facturation - DEV'), []);
    await prisma.testCase.create({
      data: {
        workflowId: fixture.sourceWorkflowId,
        name: 'mis de côté',
        expected: {},
        lastStatus: 'failed',
        enabled: false,
      },
    });

    const preview = await fixture.service.preview(fixture.sourceWorkflowId, {
      ...toProd,
      targetInstanceId: fixture.targetInstanceId,
    });

    expect(preview.gates.tests).toBeNull();
    expect(preview.blockers).toEqual([]);
  });

  it('refuse SANS contournement une contrepartie archivée sur la cible', async () => {
    const fixture = await setup(n8nWorkflow('1', 'Facturation - DEV'), [
      n8nWorkflow('99', 'Facturation - PROD', { isArchived: true } as Partial<N8nWorkflow>),
    ]);

    const preview = await fixture.service.preview(fixture.sourceWorkflowId, {
      ...toProd,
      targetInstanceId: fixture.targetInstanceId,
    });

    // n8n refuse toute écriture sur un archivé : forcer ne ferait qu'échouer plus tard.
    expect(preview.forceable).toBe(false);
    // Aucune case d'un lot ne l'ouvre : la ligne est bloquée, pas « à décider ».
    expect(preview.readiness.status).toBe('blocked');
    expect(preview.targetArchived).toBe(true);
    expect(preview.blockers.join(' ')).toContain('ARCHIVÉ');
  });

  it('préfère l’exemplaire vivant à un homonyme archivé', async () => {
    const fixture = await setup(n8nWorkflow('1', 'Facturation - DEV'), [
      n8nWorkflow('98', 'Facturation - PROD', { isArchived: true } as Partial<N8nWorkflow>),
      n8nWorkflow('99', 'Facturation - PROD'),
    ]);

    const preview = await fixture.service.preview(fixture.sourceWorkflowId, {
      ...toProd,
      targetInstanceId: fixture.targetInstanceId,
    });

    expect(preview.mode).toBe('update');
    expect(preview.targetN8nId).toBe('99');
    expect(preview.forceable).toBe(true);
  });

  it('avertit sur une credential que la cible n’a jamais vue, sans bloquer', async () => {
    const fixture = await setup(
      n8nWorkflow('1', 'Facturation - DEV', { nodes: [nodeWithCredential('Airtable', 'Airtable (dev)')] }),
      [n8nWorkflow('99', 'Autre chose', { nodes: [nodeWithCredential('Airtable', 'Airtable (prod)')] })],
    );

    const preview = await fixture.service.preview(fixture.sourceWorkflowId, {
      ...toProd,
      targetInstanceId: fixture.targetInstanceId,
    });

    // L'API n8n ne liste pas les credentials : l'heuristique par nom avertit, elle
    // n'a pas de quoi refuser.
    expect(preview.gates.credentials).toMatchObject({ ok: false, missing: ['Airtable (dev)'] });
    expect(preview.blockers).toEqual([]);
  });

  // Dev et prod cohabitent parfois sur la MÊME instance, sous des noms suffixés :
  // c'est alors l'env cible qui dit lequel on écrase. Sans lui, le workflow
  // s'écraserait avec lui-même.
  it('refuse une promotion sur la même instance sans env cible', async () => {
    const fixture = await setup(n8nWorkflow('1', 'Facturation - DEV'), []);
    const source = await prisma.workflow.findUniqueOrThrow({ where: { id: fixture.sourceWorkflowId } });

    await expect(
      fixture.service.preview(fixture.sourceWorkflowId, { targetInstanceId: source.instanceId }),
    ).rejects.toThrow(/env/i);
  });
});

/**
 * Le workflow promu écrit en « Map Automatically » des clés posées par un Set :
 * la table de la CIBLE doit les porter. Les ids de table et la credential sont
 * ceux du candidat déjà basculé, lus sur l'instance cible.
 */
describe('InstancePromoterService — tables distantes de la cible', () => {
  beforeEach(async () => {
    await resetDb();
  });

  function withAirtableWrite(name: string): N8nWorkflow {
    return n8nWorkflow('1', name, {
      nodes: [
        { name: 'Webhook', type: 'n8n-nodes-base.webhook', parameters: {} },
        {
          name: 'Préparer',
          type: 'n8n-nodes-base.set',
          typeVersion: 3.4,
          parameters: { assignments: { assignments: [{ name: 'Nom' }, { name: 'Segment' }] } },
        },
        {
          name: 'Créer lead',
          type: 'n8n-nodes-base.airtable',
          typeVersion: 2.1,
          credentials: { airtableTokenApi: { id: 'credDEV', name: 'Airtable' } },
          parameters: {
            operation: 'create',
            base: { __rl: true, mode: 'list', value: 'appDEV' },
            table: { __rl: true, mode: 'list', value: 'tblDEV' },
            columns: { mappingMode: 'autoMapInputData', value: {} },
          },
        },
      ] as never,
      connections: {
        Webhook: { main: [[{ node: 'Préparer', type: 'main', index: 0 }]] },
        Préparer: { main: [[{ node: 'Créer lead', type: 'main', index: 0 }]] },
      },
    });
  }

  async function mapToProd() {
    await prisma.resourceMapping.create({
      data: {
        provider: 'airtable',
        logicalName: 'CRM',
        values: {
          dev: { baseId: 'appDEV', tableId: 'tblDEV', credentialId: 'credDEV' },
          prod: { baseId: 'appPROD', tableId: 'tblPROD', credentialId: 'credPROD' },
        },
      },
    });
  }

  const airtableTables = (fields: string[]) => ({
    statusCode: 200,
    body: { tables: [{ id: 'tblPROD', name: 'Leads', fields: fields.map((name) => ({ name })) }] },
  });

  it('bloque quand la table de la cible n’a pas une colonne posée par le Set, et lit bien la cible', async () => {
    await mapToProd();
    const fixture = await setup(withAirtableWrite('Leads - DEV'), []);
    fixture.webhook = () => airtableTables(['Nom']);

    const preview = await fixture.service.preview(fixture.sourceWorkflowId, {
      ...toProd,
      targetInstanceId: fixture.targetInstanceId,
      checkRemote: true,
    });

    expect(fixture.probeCalls[0]?.url).toBe('https://api.airtable.com/v0/meta/bases/appPROD/tables');
    expect(preview.gates.remoteSchema?.ok).toBe(false);
    expect(preview.gates.remoteSchema?.missing).toEqual([
      expect.objectContaining({ code: 'remote-column-missing', nodeName: 'Créer lead' }),
    ]);
    expect(preview.gates.remoteSchema?.missing[0].message).toContain('Segment');
    expect(preview.blockers.join(' ')).toContain('absente(s) sur la cible');
    // Contournable : la colonne peut être créée par un autre chemin juste après.
    expect(preview.forceable).toBe(true);
  });

  it('laisse passer quand toutes les colonnes existent', async () => {
    await mapToProd();
    const fixture = await setup(withAirtableWrite('Leads - DEV'), []);
    fixture.webhook = () => airtableTables(['Nom', 'Segment']);

    const preview = await fixture.service.preview(fixture.sourceWorkflowId, {
      ...toProd,
      targetInstanceId: fixture.targetInstanceId,
      checkRemote: true,
    });

    expect(preview.gates.remoteSchema?.ok).toBe(true);
    expect(preview.blockers).toEqual([]);
  });

  it('une table illisible est « non vérifiée » : ni feu vert affiché, ni blocage', async () => {
    const fixture = await setup(withAirtableWrite('Leads - DEV'), []);
    fixture.webhook = () => ({ statusCode: 403, body: { error: { message: 'INVALID_PERMISSIONS' } } });

    const preview = await fixture.service.preview(fixture.sourceWorkflowId, {
      ...toProd,
      targetInstanceId: fixture.targetInstanceId,
      checkRemote: true,
    });

    expect(preview.gates.remoteSchema?.unverified[0]?.reason).toContain('403');
    expect(preview.gates.remoteSchema?.tables[0]?.status).toBe('unverified');
    expect(preview.blockers).toEqual([]);
  });

  it('ne crée aucune sonde sans `checkRemote`', async () => {
    const fixture = await setup(withAirtableWrite('Leads - DEV'), []);

    const preview = await fixture.service.preview(fixture.sourceWorkflowId, {
      ...toProd,
      targetInstanceId: fixture.targetInstanceId,
    });

    expect(preview.gates.remoteSchema).toBeNull();
    expect(fixture.probeCalls).toEqual([]);
  });
});

describe('InstancePromoterService — l’écriture des sélecteurs de ressource', () => {
  beforeEach(async () => {
    await resetDb();
  });

  function getRecord(base: Record<string, unknown>) {
    return {
      name: 'Get a record',
      type: 'n8n-nodes-base.airtable',
      typeVersion: 2.1,
      parameters: { base: { __rl: true, ...base }, table: { __rl: true, mode: 'list', value: 'tblLEADS' } },
    };
  }

  it('ne voit aucun écart quand la dev tape l’id que la prod a choisi dans la liste', async () => {
    await prisma.resourceMapping.create({
      data: {
        provider: 'airtable',
        logicalName: 'CRM',
        values: { dev: { baseId: 'appDEV' }, prod: { baseId: 'appPROD' } },
      },
    });
    const listed = { mode: 'list', value: 'appPROD', cachedResultName: 'CRM', cachedResultUrl: 'u' };
    const fixture = await setup(
      n8nWorkflow('1', 'SMS - DEV', { nodes: [getRecord({ mode: 'id', value: '=appDEV' })] as never }),
      [n8nWorkflow('9', 'SMS - PROD', { nodes: [getRecord(listed)] as never })],
    );

    const preview = await fixture.service.preview(fixture.sourceWorkflowId, {
      ...toProd,
      targetInstanceId: fixture.targetInstanceId,
    });

    expect(preview.mode).toBe('update');
    expect(preview.diff?.hasChanges).toBe(false);
  });

  it('montre encore une base qui change vraiment', async () => {
    const fixture = await setup(
      n8nWorkflow('1', 'SMS - DEV', { nodes: [getRecord({ mode: 'id', value: '=appAUTRE' })] as never }),
      [n8nWorkflow('9', 'SMS - PROD', { nodes: [getRecord({ mode: 'list', value: 'appPROD' })] as never })],
    );

    const preview = await fixture.service.preview(fixture.sourceWorkflowId, {
      ...toProd,
      targetInstanceId: fixture.targetInstanceId,
    });

    expect(preview.diff?.nodes.map((node) => node.name)).toEqual(['Get a record']);
  });
});

/**
 * Une URL que la cible s'apprête à servir, déjà tenue sur l'instance cible par un
 * autre workflow — typiquement la dev encore servie par l'uuid nu de son formulaire,
 * promue tout droit vers la prod qui reçoit justement cet uuid nu.
 */
describe('InstancePromoterService — URLs déjà tenues sur la cible', () => {
  const UUID = '8b13374e-3132-48f2-b9cc-5a55590bfb8f';
  const form = {
    id: 'f',
    name: 'On form submission1',
    type: 'n8n-nodes-base.formTrigger',
    typeVersion: 2.5,
    position: [0, 0],
    parameters: { formTitle: 'Ajouter manuellement', options: {} },
    webhookId: UUID,
  } as never;
  const source = () => n8nWorkflow('1', 'Formulaire - DEV', { nodes: [form] });
  const holder = (active: boolean) => n8nWorkflow('9', 'Formulaire - DEV', { nodes: [form], active });

  beforeEach(async () => {
    await resetDb();
  });

  it('annonce le déplacement du détenteur, sans bloquer par défaut', async () => {
    const fixture = await setup(source(), [holder(true)]);

    const preview = await fixture.service.preview(fixture.sourceWorkflowId, {
      ...toProd,
      targetInstanceId: fixture.targetInstanceId,
    });

    expect(preview.entryClashes).toEqual([
      expect.objectContaining({
        node: 'On form submission1',
        url: UUID,
        holderName: 'Formulaire - DEV',
        holderActive: true,
        move: `${UUID}-dev`,
      }),
    ]);
    expect(preview.blockers).toEqual([]);
  });

  it('bloque, contournable, quand on refuse de déplacer un détenteur actif', async () => {
    const fixture = await setup(source(), [holder(true)]);

    const preview = await fixture.service.preview(fixture.sourceWorkflowId, {
      ...toProd,
      moveClashing: false,
      targetInstanceId: fixture.targetInstanceId,
    });

    expect(preview.blockers.join(' ')).toContain(`/${UUID}`);
    expect(preview.blockers.join(' ')).toContain('Formulaire - DEV');
    expect(preview.forceable).toBe(true);
  });

  it('ne bloque pas pour un détenteur inactif : il ne sert rien aujourd’hui', async () => {
    const fixture = await setup(source(), [holder(false)]);

    const preview = await fixture.service.preview(fixture.sourceWorkflowId, {
      ...toProd,
      moveClashing: false,
      targetInstanceId: fixture.targetInstanceId,
    });

    expect(preview.entryClashes).toHaveLength(1);
    expect(preview.blockers).toEqual([]);
  });

  it('déplace le détenteur AVANT d’écrire la cible, sans toucher son uuid', async () => {
    const fixture = await setup(source(), [holder(true)]);

    const result = await fixture.service.promote(fixture.sourceWorkflowId, {
      ...toProd,
      confirmSkip: true,
      targetInstanceId: fixture.targetInstanceId,
    });

    expect(fixture.writes.map((write) => write.id)).toEqual(['9', 'create']);
    const moved = fixture.writes[0].workflow.nodes[0];
    expect(moved.parameters?.['options']).toEqual({ path: `${UUID}-dev` });
    expect(moved.webhookId).toBe(UUID);
    // La cible, elle, sert l'uuid nu : c'est l'URL publique.
    expect(fixture.writes[1].workflow.nodes[0].parameters?.['options']).toEqual({});
    expect(result.moved).toEqual([
      { workflowName: 'Formulaire - DEV', node: 'On form submission1', from: UUID, to: `${UUID}-dev` },
    ]);
  });

  it('ne déplace rien quand on l’a refusé', async () => {
    const fixture = await setup(source(), [holder(false)]);

    await fixture.service.promote(fixture.sourceWorkflowId, {
      ...toProd,
      moveClashing: false,
      confirmSkip: true,
      targetInstanceId: fixture.targetInstanceId,
    });

    expect(fixture.writes.map((write) => write.id)).toEqual(['create']);
  });
});

/**
 * Sur un n8n à versions, un workflow ne se publie que si les sous-workflows qu'il
 * appelle le sont. La promotion publie donc les appelés en brouillon qui ne peuvent
 * rien démarrer seuls — AVANT d'écrire la cible, qu'un PUT republie si elle l'est.
 */
describe('InstancePromoterService — sous-workflows appelés à publier', () => {
  const subTrigger = {
    id: 't',
    name: 'When Executed by Another Workflow',
    type: 'n8n-nodes-base.executeWorkflowTrigger',
    position: [0, 0],
    parameters: {},
  } as never;
  const schedule = {
    id: 's',
    name: 'Schedule',
    type: 'n8n-nodes-base.scheduleTrigger',
    position: [0, 0],
    parameters: {},
  } as never;
  const call = (target: string, label: string) =>
    ({
      id: 'c',
      name: 'Envoi',
      type: 'n8n-nodes-base.executeWorkflow',
      typeVersion: 1.2,
      position: [0, 0],
      parameters: { workflowId: { __rl: true, mode: 'list', value: target, cachedResultName: label } },
    }) as never;

  /** La source appelle « Sub - DEV » ; la cible porte « Sub - PROD », en brouillon. */
  async function withCallee(calleeNodes: never[]) {
    const fixture = await setup(n8nWorkflow('1', 'Facturation - DEV', { nodes: [call('5', 'Sub - DEV')] }), [
      n8nWorkflow('50', 'Sub - PROD', { nodes: calleeNodes, activeVersionId: null } as Partial<N8nWorkflow>),
    ]);
    const source = await prisma.workflow.findUniqueOrThrow({ where: { id: fixture.sourceWorkflowId } });
    await prisma.workflow.create({
      data: {
        instanceId: source.instanceId,
        externalId: '5',
        name: 'Sub - DEV',
        active: false,
        tags: [],
        hash: 'h',
        raw: { nodes: calleeNodes } as object,
      },
    });
    return fixture;
  }

  beforeEach(async () => {
    await resetDb();
  });

  it('annonce l’appelé en brouillon qu’elle publiera', async () => {
    const fixture = await withCallee([subTrigger]);

    const preview = await fixture.service.preview(fixture.sourceWorkflowId, {
      ...toProd,
      targetInstanceId: fixture.targetInstanceId,
    });

    expect(preview.callees).toEqual({ publish: [{ id: '50', name: 'Sub - PROD' }], manual: [] });
  });

  it('publie l’appelé AVANT d’écrire la cible', async () => {
    const fixture = await withCallee([subTrigger]);

    const result = await fixture.service.promote(fixture.sourceWorkflowId, {
      ...toProd,
      confirmSkip: true,
      targetInstanceId: fixture.targetInstanceId,
    });

    expect(fixture.writes.map((write) => write.id)).toEqual(['publish:50', 'create']);
    expect(result.callees).toEqual({ published: ['Sub - PROD'], manual: [] });
  });

  it('laisse à l’humain un appelé qui démarrerait seul, et le dit', async () => {
    const fixture = await withCallee([subTrigger, schedule]);

    const result = await fixture.service.promote(fixture.sourceWorkflowId, {
      ...toProd,
      confirmSkip: true,
      targetInstanceId: fixture.targetInstanceId,
    });

    expect(fixture.writes.map((write) => write.id)).toEqual(['create']);
    expect(result.callees?.manual).toEqual([
      { name: 'Sub - PROD', reason: expect.stringContaining('schedule') },
    ]);
  });

  it('ne publie rien quand on l’a refusé', async () => {
    const fixture = await withCallee([subTrigger]);

    await fixture.service.promote(fixture.sourceWorkflowId, {
      ...toProd,
      publishCallees: false,
      confirmSkip: true,
      targetInstanceId: fixture.targetInstanceId,
    });

    expect(fixture.writes.map((write) => write.id)).toEqual(['create']);
  });
});

/**
 * Un exemplaire verrouillé ne se réécrit pas sans un forçage qui le NOMME et le
 * justifie. Les écritures accessoires (renommer la source) le sautent sans
 * arrêter la promotion.
 */
describe('InstancePromoterService — exemplaire verrouillé', () => {
  const lockOverride = (workflowIds: string[]) => ({
    override: { workflowIds, reason: 'correctif urgent validé' },
    author: 'lea@example.com',
    action: 'POST /env-switcher/promote/x',
  });

  async function lockedTarget(fixture: Fixture): Promise<string> {
    const row = await prisma.workflow.create({
      data: {
        instanceId: fixture.targetInstanceId,
        externalId: '99',
        name: 'Facturation - PROD',
        active: true,
        tags: [],
        hash: 'h',
        raw: n8nWorkflow('99', 'Facturation - PROD') as unknown as object,
      },
    });
    await new WorkflowLockService(prisma).lock(row.id, 'paul@example.com');
    return row.id;
  }

  beforeEach(async () => {
    await resetDb();
  });

  it('annonce la cible verrouillée comme une décision', async () => {
    const fixture = await setup(n8nWorkflow('1', 'Facturation - DEV'), [
      n8nWorkflow('99', 'Facturation - PROD'),
    ]);
    await lockedTarget(fixture);

    const preview = await fixture.service.preview(fixture.sourceWorkflowId, {
      ...toProd,
      targetInstanceId: fixture.targetInstanceId,
    });

    expect(preview.targetLocked).toBe(true);
    expect(preview.readiness.decisions.map((decision) => decision.code)).toContain('locked');
  });

  it('refuse d’écraser la cible verrouillée, sans rien écrire', async () => {
    const fixture = await setup(n8nWorkflow('1', 'Facturation - DEV'), [
      n8nWorkflow('99', 'Facturation - PROD'),
    ]);
    await lockedTarget(fixture);

    await expect(
      fixture.service.promote(fixture.sourceWorkflowId, {
        ...toProd,
        confirmSkip: true,
        force: true,
        targetInstanceId: fixture.targetInstanceId,
      }),
    ).rejects.toBeInstanceOf(WorkflowLockedException);
    expect(fixture.writes).toEqual([]);
  });

  it('écrase la cible quand le forçage la nomme, et le journalise une fois', async () => {
    const fixture = await setup(n8nWorkflow('1', 'Facturation - DEV'), [
      n8nWorkflow('99', 'Facturation - PROD'),
    ]);
    const targetId = await lockedTarget(fixture);

    await runWithLockContext(lockOverride([targetId]), () =>
      fixture.service.promote(fixture.sourceWorkflowId, {
        ...toProd,
        confirmSkip: true,
        targetInstanceId: fixture.targetInstanceId,
      }),
    );

    expect(fixture.writes.map((write) => write.id)).toEqual(['99']);
    const journal = await prisma.workflowLockOverride.findMany({ where: { workflowId: targetId } });
    expect(journal).toEqual([
      expect.objectContaining({
        reason: 'correctif urgent validé',
        author: 'lea@example.com',
        action: 'POST /env-switcher/promote/x',
      }),
    ]);
    expect(await prisma.workflowLock.count({ where: { workflowId: targetId } })).toBe(1);
  });

  it('ne lève pas un verrou que le forçage ne nomme pas', async () => {
    const fixture = await setup(n8nWorkflow('1', 'Facturation - DEV'), [
      n8nWorkflow('99', 'Facturation - PROD'),
    ]);
    await lockedTarget(fixture);

    await expect(
      runWithLockContext(lockOverride(['un-autre']), () =>
        fixture.service.promote(fixture.sourceWorkflowId, {
          ...toProd,
          confirmSkip: true,
          targetInstanceId: fixture.targetInstanceId,
        }),
      ),
    ).rejects.toBeInstanceOf(WorkflowLockedException);
    expect(fixture.writes).toEqual([]);
  });

  it('promeut depuis une source verrouillée sans toucher à son nom', async () => {
    const fixture = await setup(n8nWorkflow('1', 'Facturation (1.0.0) - DEV'), []);
    await new WorkflowLockService(prisma).lock(fixture.sourceWorkflowId);

    const result = await fixture.service.promote(fixture.sourceWorkflowId, {
      ...toProd,
      confirmSkip: true,
      targetInstanceId: fixture.targetInstanceId,
    });

    expect(fixture.writes.map((write) => write.id)).toEqual(['create']);
    expect(result.renames).toContainEqual(expect.objectContaining({ status: 'locked' }));
  });
});

/** « Publier comme la source » : l'option qui fait d'une promotion un déploiement, à la demande. */
describe('InstancePromoterService — publier comme la source', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('publie la cible après l’avoir écrite quand la source est publiée et que c’est demandé', async () => {
    const fixture = await setup(n8nWorkflow('1', 'Facturation - DEV', { active: true }), []);

    const result = await fixture.service.promote(fixture.sourceWorkflowId, {
      ...toProd,
      publishLikeSource: true,
      confirmSkip: true,
      targetInstanceId: fixture.targetInstanceId,
    });

    expect(fixture.writes.map((write) => write.id)).toEqual(['create', 'activate:probe']);
    expect(result.publication?.status).toBe('done');
  });

  it('sans l’option, la cible reste comme elle était : promouvoir ne déploie pas', async () => {
    const fixture = await setup(n8nWorkflow('1', 'Facturation - DEV', { active: true }), []);

    const result = await fixture.service.promote(fixture.sourceWorkflowId, {
      ...toProd,
      confirmSkip: true,
      targetInstanceId: fixture.targetInstanceId,
    });

    expect(fixture.writes.map((write) => write.id)).toEqual(['create']);
    expect(result.publication).toBeUndefined();
  });
});
