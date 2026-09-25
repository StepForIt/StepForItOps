import { describe, expect, it } from 'vitest';
import { N8nApiPort, N8nWorkflow, RemoteTableLocator } from '@nwm/core';
import { RemoteSchemaReaderService } from '../src/infra/remote-schema/remote-schema-reader.service';
import { N8nProbeService } from '../src/infra/n8n-probe/n8n-probe.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';

/**
 * La lecture des tables distantes par une sonde n8n : une sonde par credential,
 * un appel par corps de requête distinct, et une table illisible qui reste
 * « non vérifiée » plutôt que de passer pour saine.
 */

const config = { baseUrl: 'http://n8n', apiKey: 'k' };

interface Harness {
  reader: RemoteSchemaReaderService;
  created: N8nWorkflow[];
  calls: Array<Record<string, unknown>>;
  deleted: string[];
}

function harness(
  respond: (payload: Record<string, unknown>) => unknown,
  endpoints: Record<string, string> = {},
): Harness {
  const h = { created: [], calls: [], deleted: [] } as unknown as Harness;
  const n8n = {
    async createWorkflow(_config: unknown, workflow: N8nWorkflow) {
      h.created.push(workflow);
      return { id: `wf${h.created.length}` };
    },
    async activateWorkflow() {},
    async deleteWorkflow(_config: unknown, id: string) {
      h.deleted.push(id);
    },
    async callWebhook(_config: unknown, _path: string, payload: Record<string, unknown>) {
      h.calls.push(payload);
      return respond(payload);
    },
  } as unknown as N8nApiPort;
  const prisma = {
    providerEndpoint: {
      async findUnique({ where }: { where: { provider_credentialId: { credentialId: string } } }) {
        const host = endpoints[where.provider_credentialId.credentialId];
        return host ? { host } : null;
      },
    },
  } as unknown as PrismaService;
  h.reader = new RemoteSchemaReaderService(prisma, new N8nProbeService(n8n));
  return h;
}

const airtableCredential = { type: 'airtableTokenApi', id: 'c1' };

describe('RemoteSchemaReaderService', () => {
  it('Airtable : deux tables de la même base, une sonde et un seul appel', async () => {
    const h = harness(() => ({
      statusCode: 200,
      body: {
        tables: [
          { id: 'tblA', name: 'Leads', fields: [{ name: 'Nom' }] },
          { id: 'tblB', name: 'Deals', fields: [{ name: 'Montant' }] },
        ],
      },
    }));
    const locators: RemoteTableLocator[] = [
      {
        provider: 'airtable',
        key: 'a',
        ids: { base: 'app1', table: 'tblA' },
        credential: airtableCredential,
      },
      {
        provider: 'airtable',
        key: 'b',
        ids: { base: 'app1', table: 'Deals' },
        credential: airtableCredential,
      },
      {
        provider: 'airtable',
        key: 'c',
        ids: { base: 'app1', table: 'tblGone' },
        credential: airtableCredential,
      },
    ];

    const outcomes = await h.reader.readAll(config, locators);

    expect(h.created).toHaveLength(1);
    expect(h.calls).toHaveLength(1);
    expect(h.deleted).toEqual(['wf1']);
    expect(outcomes.get('a')).toEqual({
      status: 'read',
      schema: { found: true, columns: [{ name: 'Nom' }] },
    });
    expect(outcomes.get('b')).toEqual({
      status: 'read',
      schema: { found: true, columns: [{ name: 'Montant' }] },
    });
    expect(outcomes.get('c')).toEqual({ status: 'read', schema: { found: false } });
  });

  it('Sheets par gid : titre de l’onglet, puis ligne d’en-tête', async () => {
    const h = harness((payload) =>
      String(payload.url).includes('fields=sheets.properties')
        ? { statusCode: 200, body: { sheets: [{ properties: { sheetId: 7, title: "Liste d'attente" } }] } }
        : { statusCode: 200, body: { values: [['Nom', 'Email']] } },
    );

    const outcomes = await h.reader.readAll(config, [
      {
        provider: 'google-sheets',
        key: 's',
        ids: { document: 'doc1', sheet: '7', sheetMode: 'gid' },
        credential: { type: 'googleSheetsOAuth2Api', id: 'g1' },
      },
    ]);

    expect(String(h.calls[1].url)).toContain(encodeURIComponent("'Liste d''attente'!1:1"));
    expect(outcomes.get('s')).toEqual({
      status: 'read',
      schema: { found: true, columns: [{ name: 'Nom' }, { name: 'Email' }] },
    });
  });

  it('Postgres : sonde dédiée, schéma et table passés en paramètres', async () => {
    const h = harness(() => [{ column_name: 'email', data_type: 'text' }]);

    const outcomes = await h.reader.readAll(config, [
      {
        provider: 'postgres',
        key: 'p',
        ids: { schema: 'crm', table: 'leads' },
        credential: { type: 'postgres', id: 'pg' },
      },
    ]);

    expect(h.created[0].nodes.some((node) => node.type === 'n8n-nodes-base.postgres')).toBe(true);
    expect(h.calls).toEqual([{ schema: 'crm', table: 'leads' }]);
    expect(outcomes.get('p')).toEqual({
      status: 'read',
      schema: { found: true, columns: [{ name: 'email', type: 'text' }] },
    });
  });

  it('NocoDB sans URL connue : non vérifiable, et aucune sonde créée pour rien', async () => {
    const h = harness(() => ({ statusCode: 200, body: {} }));

    const outcomes = await h.reader.readAll(config, [
      {
        provider: 'nocodb',
        key: 'n',
        ids: { project: 'p', table: 'm1' },
        credential: { type: 'nocoDbApiToken', id: 'n1' },
      },
    ]);

    expect(outcomes.get('n')?.status).toBe('unverified');
    expect(h.created).toEqual([]);
  });

  it('NocoDB avec URL : lue sur l’hôte de la credential', async () => {
    const h = harness(
      () => ({ statusCode: 200, body: { columns: [{ title: 'Nom', column_name: 'nom' }] } }),
      {
        n1: 'noco.example.com/',
      },
    );

    await h.reader.readAll(config, [
      {
        provider: 'nocodb',
        key: 'n',
        ids: { project: 'p', table: 'm1' },
        credential: { type: 'nocoDbApiToken', id: 'n1' },
      },
    ]);

    expect(h.calls[0].url).toBe('https://noco.example.com/api/v2/meta/tables/m1');
  });

  it('un 404 dit « table introuvable », un refus dit « non vérifiée »', async () => {
    const notFound = harness(() => ({ statusCode: 404, body: { message: 'Could not find database' } }));
    const refused = harness(() => ({ statusCode: 401, body: { message: 'unauthorized' } }));
    const locator: RemoteTableLocator = {
      provider: 'notion',
      key: 'd',
      ids: { database: 'db1' },
      credential: { type: 'notionApi', id: 'nt' },
    };

    expect((await notFound.reader.readAll(config, [locator])).get('d')).toEqual({
      status: 'read',
      schema: { found: false },
    });
    expect((await refused.reader.readAll(config, [locator])).get('d')?.status).toBe('unverified');
  });

  it('un nœud sans credential n’est pas lu', async () => {
    const h = harness(() => ({}));
    const outcomes = await h.reader.readAll(config, [
      { provider: 'airtable', key: 'x', ids: { base: 'a', table: 't' } },
    ]);
    expect(outcomes.get('x')).toEqual({ status: 'unverified', reason: 'le nœud ne porte aucune credential' });
    expect(h.created).toEqual([]);
  });
});
