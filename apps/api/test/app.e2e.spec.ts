import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { N8nApiError, N8nWorkflow } from '@nwm/core';
import { TestApp, startTestApp } from './helpers/app';
import { resetDb, testPrisma } from './helpers/db';

/**
 * L'API vue du navigateur.
 *
 * Ce qui se vérifie ici n'existe dans aucun service : la convention de
 * pagination que le dataProvider du front attend (`_start`/`_end` +
 * `x-total-count`), le filtre des archivés que chaque liste doit fusionner dans
 * son `where`, la traduction des erreurs Prisma en 400/404, le garde des modules
 * désactivés. Un service rend un objet ; ce qui arrive au navigateur est décidé
 * après lui, et personne ne le regardait.
 */

const prisma = testPrisma();

/** Le contenu servi par le faux n8n, réécrit par les tests. */
const upstream = new Map<string, N8nWorkflow>();
let fetchFails = false;
let authRefused = false;

let testApp: TestApp;
let app: INestApplication;

function n8nWorkflow(id: string, name: string, extra: Partial<N8nWorkflow> = {}): N8nWorkflow {
  return { id, name, nodes: [], connections: {}, active: false, ...extra } as N8nWorkflow;
}

async function seedWorkflow(
  instanceId: string,
  name: string,
  extra: { tags?: string[]; archivedUpstream?: boolean; externalId?: string } = {},
): Promise<string> {
  const externalId = extra.externalId ?? name.toLowerCase().replace(/\W+/g, '-');
  const raw = n8nWorkflow(externalId, name);
  upstream.set(externalId, raw);
  const row = await prisma.workflow.create({
    data: {
      instanceId,
      externalId,
      name,
      active: false,
      tags: extra.tags ?? [],
      archivedUpstream: extra.archivedUpstream ?? false,
      hash: `h-${externalId}`,
      raw: raw as unknown as object,
    },
  });
  return row.id;
}

describe('API (bout en bout)', () => {
  beforeAll(async () => {
    testApp = await startTestApp({
      ports: {
        n8n: {
          async listWorkflows() {
            return [...upstream.values()];
          },
          async getWorkflow(_config: unknown, externalId: string) {
            if (fetchFails) throw new N8nApiError('n8n injoignable', 502);
            if (authRefused)
              throw new N8nApiError('n8n API GET /workflows/x → 401: {"message":"unauthorized"}', 401);
            const found = upstream.get(externalId);
            if (!found) throw new N8nApiError('introuvable', 404);
            return found;
          },
          async updateWorkflow(_config: unknown, externalId: string, workflow: N8nWorkflow) {
            upstream.set(externalId, workflow);
            return workflow;
          },
          async listTags() {
            return [];
          },
          async createTag(_config: unknown, name: string) {
            return { id: `tag-${name}`, name };
          },
          async setWorkflowTags() {},
        },
      },
    });
    app = testApp.app;
  });

  afterAll(async () => {
    await testApp.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDb();
    upstream.clear();
    fetchFails = false;
    authRefused = false;
  });

  async function makeInstance(): Promise<string> {
    const instance = await prisma.instance.create({
      data: { name: 'Prod', baseUrl: 'http://n8n', apiKey: 'k' },
    });
    return instance.id;
  }

  describe('la liste des workflows', () => {
    it('respecte la convention simple-rest : fenêtre, tri, et total dans l’en-tête', async () => {
      const instanceId = await makeInstance();
      for (const name of ['Charlie', 'Alpha', 'Bravo']) await seedWorkflow(instanceId, name);

      const response = await request(app.getHttpServer())
        .get('/workflows?_start=0&_end=2&_sort=name&_order=asc')
        .expect(200);

      expect(response.body.map((row: { name: string }) => row.name)).toEqual(['Alpha', 'Bravo']);
      // Le total est celui de la REQUÊTE, pas de la page : sans lui, la
      // pagination du front s'arrête à la première page.
      expect(response.headers['x-total-count']).toBe('3');
    });

    it('écarte les archivés par défaut, et les rend quand le réglage le dit', async () => {
      const instanceId = await makeInstance();
      await seedWorkflow(instanceId, 'Vivant');
      await seedWorkflow(instanceId, 'Rangé', { archivedUpstream: true });
      await seedWorkflow(instanceId, 'Rangé à la main', { tags: ['archived'] });

      const hidden = await request(app.getHttpServer()).get('/workflows').expect(200);
      expect(hidden.body.map((row: { name: string }) => row.name)).toEqual(['Vivant']);
      expect(hidden.headers['x-total-count']).toBe('1');

      await request(app.getHttpServer())
        .put('/settings/platform')
        .send({ includeArchived: true })
        .expect(200);

      const shown = await request(app.getHttpServer()).get('/workflows').expect(200);
      expect(shown.body).toHaveLength(3);
    });

    it('traduit un tri sur une colonne inconnue en 400, pas en 500', async () => {
      await makeInstance();

      const response = await request(app.getHttpServer()).get('/workflows?_sort=nexistePas');

      // Une requête invalide vient de l'appelant : la lui rendre en 500 ferait
      // chercher une panne là où il y a une faute de frappe.
      expect(response.status).toBe(400);
    });

    it('répond dans la langue de l’appelant, sinon dans celle de la plateforme', async () => {
      await makeInstance();
      const message = async (headers: Record<string, string>) => {
        const response = await request(app.getHttpServer()).get('/workflows?_sort=nexistePas').set(headers);
        return response.body.message as string;
      };

      expect(await message({ 'x-locale': 'en' })).toMatch(/^Invalid request/);
      expect(await message({ 'x-locale': 'fr', 'accept-language': 'en' })).toMatch(/^Requête invalide/);
      expect(await message({ 'accept-language': 'en-GB,fr;q=0.5' })).toMatch(/^Invalid request/);
      expect(await message({})).toMatch(/^Requête invalide/);

      await request(app.getHttpServer()).put('/settings/platform').send({ defaultLocale: 'en' }).expect(200);
      expect(await message({})).toMatch(/^Invalid request/);
      await request(app.getHttpServer()).put('/settings/platform').send({ defaultLocale: 'fr' }).expect(200);
    });
  });

  describe('un workflow', () => {
    it('répond 404 sur un identifiant inconnu', async () => {
      await request(app.getHttpServer()).get('/workflows/00000000-0000-0000-0000-000000000000').expect(404);
    });

    it('exporte depuis n8n, débarrassé de l’identité de l’exemplaire', async () => {
      const instanceId = await makeInstance();
      const id = await seedWorkflow(instanceId, 'Facturation');
      upstream.set('facturation', {
        ...n8nWorkflow('facturation', 'Facturation'),
        versionId: 'v-42',
        active: true,
      } as N8nWorkflow);

      const response = await request(app.getHttpServer()).get(`/workflows/${id}/export`).expect(200);

      expect(response.body.stale).toBe(false);
      // `json` est le TEXTE indenté, tel qu'il sera collé ou téléchargé : l'API
      // ne le re-sérialise pas.
      const exported = JSON.parse(response.body.json);
      // Tel quel, il se réimporte dans n'importe quel n8n sans se rattacher au
      // workflow source.
      expect(exported.id).toBeUndefined();
      expect(exported.versionId).toBeUndefined();
      expect(exported.active).toBeUndefined();
      expect(exported.name).toBe('Facturation');
    });

    it('sert l’écart avec la prod, et 404 quand il n’y a pas de prod', async () => {
      const instanceId = await makeInstance();
      const dev = await seedWorkflow(instanceId, 'Facturation - DEV');
      await request(app.getHttpServer()).get(`/workflows/${dev}/divergence`).expect(404);

      await seedWorkflow(instanceId, 'Facturation - PROD');
      const response = await request(app.getHttpServer()).get(`/workflows/${dev}/divergence`).expect(200);

      expect(response.body.status).toBe('in-sync');
      expect(response.body.reference.env).toBe('prod');
      expect(response.body.diff.hasChanges).toBe(false);
    });

    it('retombe sur la copie locale en le DISANT quand n8n ne répond pas', async () => {
      const instanceId = await makeInstance();
      const id = await seedWorkflow(instanceId, 'Facturation');
      fetchFails = true;

      const response = await request(app.getHttpServer()).get(`/workflows/${id}/export`).expect(200);

      // Ni refus, ni état périmé servi en silence.
      expect(response.body.stale).toBe(true);
      expect(JSON.parse(response.body.json).name).toBe('Facturation');
    });
  });

  // Le verrou n'existe qu'assemblé : le contexte de la requête (en-têtes de
  // forçage, auteur, route) est posé par un middleware, et le 423 traverse le
  // filtre d'exceptions avec le corps que la console lit pour ouvrir sa modale.
  describe('un exemplaire verrouillé', () => {
    it('refuse l’écriture en 423 qui nomme le workflow, puis l’accepte forcée et la journalise', async () => {
      const instanceId = await makeInstance();
      const id = await seedWorkflow(instanceId, 'Facturation - PROD');
      upstream.set('facturation-prod', n8nWorkflow('facturation-prod', 'Facturation - PROD'));
      await request(app.getHttpServer())
        .put(`/workflow-locks/${id}`)
        .set('x-user-email', 'paul@example.com')
        .send({ note: 'gel de fin d’année' })
        .expect(200);

      const refused = await request(app.getHttpServer()).post(`/workflows/${id}/archive`).expect(423);
      expect(refused.body.code).toBe('workflow-locked');
      expect(refused.body.locked).toEqual([expect.objectContaining({ id, name: 'Facturation - PROD' })]);
      expect(refused.body.message).toContain('Facturation - PROD');
      expect(upstream.get('facturation-prod')?.name).toBe('Facturation - PROD');

      // Une raison trop courte ne lève rien.
      await request(app.getHttpServer())
        .post(`/workflows/${id}/archive`)
        .set('x-lock-override', id)
        .set('x-lock-override-reason', 'ok')
        .expect(423);

      await request(app.getHttpServer())
        .post(`/workflows/${id}/archive`)
        .set('x-lock-override', id)
        .set('x-lock-override-reason', encodeURIComponent('archivage validé par Léa'))
        .set('x-user-email', 'lea@example.com')
        .expect(201);
      expect(upstream.get('facturation-prod')?.name).toContain('[ARCHIVED]');

      const detail = await request(app.getHttpServer()).get(`/workflow-locks/${id}`).expect(200);
      expect(detail.body.lock).toMatchObject({ lockedBy: 'paul@example.com', note: 'gel de fin d’année' });
      expect(detail.body.overrides).toEqual([
        expect.objectContaining({
          reason: 'archivage validé par Léa',
          author: 'lea@example.com',
          action: `POST /workflows/${id}/archive`,
        }),
      ]);
    });

    it('rend l’écriture libre une fois déverrouillé', async () => {
      const instanceId = await makeInstance();
      const id = await seedWorkflow(instanceId, 'Facturation - PROD');
      upstream.set('facturation-prod', n8nWorkflow('facturation-prod', 'Facturation - PROD'));
      await request(app.getHttpServer()).put(`/workflow-locks/${id}`).send({}).expect(200);
      await request(app.getHttpServer()).delete(`/workflow-locks/${id}`).expect(200);

      await request(app.getHttpServer()).post(`/workflows/${id}/archive`).expect(201);
      const list = await request(app.getHttpServer()).get('/workflow-locks').expect(200);
      expect(list.body).toEqual([]);
    });
  });

  describe('les refus de n8n', () => {
    // Une clé révoquée est un réglage à reprendre : rendue en 500, elle se lisait
    // « erreur interne » à l'écran et ouvrait un événement Sentry à chaque clic.
    it('rend une clé API refusée en 502 qui dit quoi corriger', async () => {
      const instanceId = await makeInstance();
      const id = await seedWorkflow(instanceId, 'Facturation');
      authRefused = true;

      const response = await request(app.getHttpServer()).post(`/workflows/${id}/resync`).expect(502);

      expect(response.body.message).toContain('clé API');
      expect(response.body.message).toContain("fiche de l'instance");
    });
  });

  describe('les modules', () => {
    // 404 et non 403 : un module désactivé n'existe pas pour l'appelant, ses
    // routes non plus. C'est le choix de `ModuleEnabledGuard`.
    it('rend introuvables les routes d’un module désactivé', async () => {
      const instanceId = await makeInstance();
      const id = await seedWorkflow(instanceId, 'Facturation');

      await request(app.getHttpServer()).patch('/modules/verifier').send({ enabled: false }).expect(200);
      await request(app.getHttpServer()).post(`/verifier/run/${id}`).expect(404);

      await request(app.getHttpServer()).patch('/modules/verifier').send({ enabled: true }).expect(200);
      // Réactivé, la route existe de nouveau : ce n'est plus le garde qui répond.
      const after = await request(app.getHttpServer()).post(`/verifier/run/${id}`);
      expect(after.status).not.toBe(404);
    });

    it("garde les routes d'édition d'une procédure derrière leur module, et refuse un ordre incomplet en 400", async () => {
      const created = await request(app.getHttpServer())
        .post('/release-procedures/recording')
        .send({ name: 'Checklist' })
        .expect(201);
      const id = created.body.id as string;
      await request(app.getHttpServer())
        .post(`/release-procedures/${id}/steps`)
        .send({ label: 'A' })
        .expect(201);

      await request(app.getHttpServer())
        .patch('/modules/release-procedures')
        .send({ enabled: false })
        .expect(200);
      await request(app.getHttpServer())
        .put(`/release-procedures/${id}/steps/order`)
        .send({ order: [] })
        .expect(404);

      await request(app.getHttpServer())
        .patch('/modules/release-procedures')
        .send({ enabled: true })
        .expect(200);
      const refused = await request(app.getHttpServer())
        .put(`/release-procedures/${id}/steps/order`)
        .send({ order: [] })
        .expect(400);
      expect(refused.body.message).toContain('exactement');
    });

    it('ne laisse pas désactiver un module core', async () => {
      const response = await request(app.getHttpServer())
        .patch('/modules/workflows')
        .send({ enabled: false });

      // Refus, pas panne : un `Error` nu ressortait en 500, journalisé comme une
      // faute du serveur alors que c'est la demande qui n'a pas de sens.
      expect(response.status).toBe(400);
      const listed = await request(app.getHttpServer()).get('/modules').expect(200);
      expect(listed.body.find((module: { id: string }) => module.id === 'workflows').enabled).toBe(true);
    });
  });
});

/**
 * Le garde de jeton, qui n'existe qu'avec `API_ACCESS_TOKEN` posé — d'où une
 * application à part : la variable est lue au démarrage.
 *
 * C'est la seule chose qui sépare l'API d'un accès anonyme dès que son port est
 * joignable. Elle est fail-open en dev par choix, et ce choix mérite d'être
 * tenu par un test plutôt que par la mémoire de celui qui l'a écrit.
 */
describe('API protégée par un jeton', () => {
  let guarded: TestApp;

  beforeAll(async () => {
    guarded = await startTestApp({ env: { API_ACCESS_TOKEN: 'jeton-de-test' } });
  });

  afterAll(async () => {
    await guarded.close();
  });

  it('refuse un appel sans jeton', async () => {
    await request(guarded.app.getHttpServer()).get('/workflows').expect(401);
  });

  it('refuse un jeton qui n’est pas le bon', async () => {
    await request(guarded.app.getHttpServer()).get('/workflows').set('x-api-token', 'presque').expect(401);
  });

  it('laisse passer le jeton du proxy', async () => {
    await request(guarded.app.getHttpServer())
      .get('/workflows')
      .set('x-api-token', 'jeton-de-test')
      .expect(200);
  });
});
