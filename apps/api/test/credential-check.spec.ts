import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CREDENTIAL_SCHEDULE, EVENTS, N8nInstanceConfig, N8nWorkflow } from '@nwm/core';
import { CredentialWatchService } from '../src/modules/credential-check/credential-watch.service';
import { CredentialCheckSettingsService } from '../src/modules/credential-check/credential-check-settings.service';
import { ModuleRegistryService } from '../src/infra/modules-registry/module-registry.service';
import { EventBusService } from '../src/infra/events/event-bus.service';
import { CredentialCheckService } from '../src/modules/credential-check/credential-check.service';
import { N8nProbeService, ProbeCall } from '../src/infra/n8n-probe/n8n-probe.service';
import { PlatformSettingsService } from '../src/infra/settings/platform-settings.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { InstancesService } from '../src/modules/instances/instances.service';
import { resetDb, testPrisma } from './helpers/db';
import { n8nWorkflow, seedInstance, seedWorkflow } from './helpers/workflow-fixtures';

/**
 * Le test d'une credential s'appuie sur ce que la plateforme a VU dans les
 * workflows, jamais sur un id fourni par l'appelant, et rend un verdict lu
 * dans la réponse du fournisseur. La sonde n8n est remplacée par une doublure.
 */

const prisma = testPrisma();

function nodeWith(type: string, id: string, name: string) {
  return {
    name: `Node ${id}`,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4,
    parameters: {},
    position: [0, 0] as [number, number],
    credentials: { [type]: { id, name } },
  };
}

function makeService(answer: unknown) {
  const calls: unknown[] = [];
  const probe = {
    newWebhookPath: () => 'p',
    async run(
      _c: N8nInstanceConfig,
      _w: N8nWorkflow,
      _p: string,
      work: (call: ProbeCall) => Promise<unknown>,
    ) {
      return work(async (payload) => {
        calls.push(payload);
        return answer;
      });
    },
  } as unknown as N8nProbeService;
  const settings = { workflowFilter: async () => ({}) } as unknown as PlatformSettingsService;
  const instances = { getConfig: async () => ({}) } as unknown as InstancesService;
  const emitted: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const eventBus = {
    emit: (name: string, payload: Record<string, unknown>) => emitted.push({ name, payload }),
  } as unknown as EventBusService;
  const service = new CredentialCheckService(
    prisma as unknown as PrismaService,
    settings,
    instances,
    probe,
    eventBus,
  );
  const checkSettings = new CredentialCheckSettingsService(prisma as unknown as PrismaService);
  const watch = new CredentialWatchService(prisma as unknown as PrismaService, service, checkSettings, {
    isEnabled: async () => true,
  } as unknown as ModuleRegistryService);
  return { service, calls, emitted, watch, checkSettings };
}

describe('CredentialCheckService', () => {
  beforeEach(resetDb);
  afterAll(async () => prisma.$disconnect());

  async function seed() {
    const instanceId = await seedInstance(prisma);
    await seedWorkflow(
      prisma,
      instanceId,
      n8nWorkflow('wf1', 'Chat', {
        nodes: [
          nodeWith('openAiApi', 'cred-openai', 'OpenAI prod'),
          nodeWith('openAiApi', 'cred-openai', 'OpenAI prod'),
          nodeWith('slackApi', 'cred-slack', 'Slack'),
        ] as N8nWorkflow['nodes'],
      }),
    );
    return instanceId;
  }

  it('ne liste que les credentials de fournisseurs IA, comptées par nœud', async () => {
    const instanceId = await seed();
    const { service } = makeService(null);
    const list = await service.list(instanceId);
    expect(list).toEqual([
      expect.objectContaining({
        credentialId: 'cred-openai',
        provider: 'openai',
        usedBy: 2,
        quotaCheck: true,
      }),
    ]);
  });

  it('rend « refusée » sur un 401 et ne garde que le message du fournisseur', async () => {
    const instanceId = await seed();
    const { service, calls } = makeService({
      statusCode: 401,
      body: { error: { message: 'Incorrect API key' } },
    });
    const result = await service.check(instanceId, 'cred-openai', 'auth');
    expect(result).toMatchObject({
      verdict: 'rejected',
      status: 401,
      detail: 'Incorrect API key',
      level: 'auth',
    });
    expect(calls).toEqual([
      expect.objectContaining({ url: 'https://api.openai.com/v1/models', method: 'GET' }),
    ]);
  });

  it('le niveau crédit joue l’appel qui génère et voit un compte à sec', async () => {
    const instanceId = await seed();
    const { service, calls } = makeService({
      statusCode: 429,
      body: { error: { message: 'You exceeded your current quota', code: 'insufficient_quota' } },
    });
    const result = await service.check(instanceId, 'cred-openai', 'quota');
    expect(result.verdict).toBe('no-credit');
    expect(calls).toEqual([expect.objectContaining({ method: 'POST' })]);
  });

  it('un échec avant réponse du fournisseur n’accuse pas la credential', async () => {
    const instanceId = await seed();
    const { service } = makeService({ error: { message: 'getaddrinfo ENOTFOUND api.openai.com' } });
    expect((await service.check(instanceId, 'cred-openai', 'auth')).verdict).toBe('unreachable');
  });

  it('refuse un id que les workflows de l’instance ne portent pas', async () => {
    const instanceId = await seed();
    const { service, calls } = makeService({ statusCode: 200 });
    await expect(service.check(instanceId, 'cred-slack', 'auth')).rejects.toThrow();
    await expect(service.check(instanceId, 'inconnu', 'auth')).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('alerte une fois par panne, pas à chaque passage', async () => {
    const instanceId = await seed();
    const { service, emitted } = makeService({
      statusCode: 401,
      body: { error: { message: 'Incorrect API key' } },
    });
    await service.check(instanceId, 'cred-openai', 'auth');
    await service.check(instanceId, 'cred-openai', 'auth');
    expect(emitted.filter((e) => e.name === EVENTS.credentialCheckFailed)).toHaveLength(1);
    expect(emitted[0]!.payload).toMatchObject({
      verdict: 'rejected',
      provider: 'openai',
      credentialId: 'cred-openai',
    });
  });

  it('un simple accès accepté ne lève pas une alerte de crédit, un test de crédit oui', async () => {
    const instanceId = await seed();
    const dry = makeService({ statusCode: 429, body: { error: { message: 'insufficient_quota' } } });
    await dry.service.check(instanceId, 'cred-openai', 'quota');
    const ok = makeService({ statusCode: 200 });
    await ok.service.check(instanceId, 'cred-openai', 'auth');
    expect((await prisma.credentialCheckState.findFirstOrThrow()).alertedVerdict).toBe('no-credit');
    await ok.service.check(instanceId, 'cred-openai', 'quota');
    expect((await prisma.credentialCheckState.findFirstOrThrow()).alertedVerdict).toBeNull();
  });

  it('expose le dernier verdict connu dans la liste', async () => {
    const instanceId = await seed();
    const { service } = makeService({ statusCode: 200 });
    await service.check(instanceId, 'cred-openai', 'auth');
    expect((await service.list(instanceId))[0]!.last).toMatchObject({ verdict: 'ok', level: 'auth' });
  });

  it('le cron ne joue que ce qui est dû, et suit les fréquences réglées', async () => {
    await seed();
    const { watch, calls, checkSettings } = makeService({ statusCode: 200 });
    // L'horloge réelle : `check()` estampille avec `new Date()`, un `now` figé dans le passé rendrait l'état « futur » et rien ne serait dû.
    const now = new Date();

    // Jamais testée : le crédit (donc l'accès) part tout de suite.
    expect(await watch.run(now)).toMatchObject({ checked: 1 });
    expect(calls).toHaveLength(1);

    // Trois heures plus tard, rien n'est dû aux rythmes par défaut.
    expect(await watch.run(new Date(now.getTime() + 3 * 3_600_000))).toMatchObject({ checked: 0 });

    // Réglé à l'heure, l'accès repart (et seulement lui : le crédit reste hebdomadaire).
    await checkSettings.update({ accessEveryHours: 1 });
    await watch.run(new Date(now.getTime() + 3 * 3_600_000));
    expect(calls).toHaveLength(2);
    expect((calls[1] as { method: string }).method).toBe('GET');
  });

  it('le cron se tait quand le test automatique est coupé', async () => {
    await seed();
    const { watch, calls, checkSettings } = makeService({ statusCode: 200 });
    await checkSettings.update({ enabled: false });
    expect(await watch.run()).toEqual({ checked: 0, failed: 0 });
    expect(calls).toEqual([]);
  });

  it('borne les fréquences saisies', async () => {
    const { checkSettings } = makeService(null);
    const saved = await checkSettings.update({ accessEveryHours: 0, creditEveryHours: 99999 });
    expect(saved.accessEveryHours).toBe(1);
    expect(saved.creditEveryHours).toBe(24 * 90);
    expect(DEFAULT_CREDENTIAL_SCHEDULE.accessEveryHours).toBe(24);
  });
});
