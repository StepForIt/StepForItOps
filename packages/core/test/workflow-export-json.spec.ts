import { describe, expect, it } from 'vitest';
import {
  toExportableWorkflow,
  workflowExportFileName,
  workflowExportText,
} from '../src/domain/n8n/workflow-export-json';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';

const raw = {
  id: 'abc123',
  name: 'Facturation client',
  active: true,
  versionId: 'v-9',
  createdAt: '2026-01-01T00:00:00.000Z',
  meta: { instanceId: 'inst-1' },
  nodes: [{ name: 'Webhook', type: 'n8n-nodes-base.webhook' }],
  connections: { Webhook: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
  settings: { executionOrder: 'v1' },
  pinData: { Webhook: [{ json: { email: 'client@exemple.fr' } }] },
  tags: [{ id: 't1', name: 'prod' }],
} as unknown as N8nWorkflow;

describe('toExportableWorkflow', () => {
  it("retire l'identité de l'exemplaire d'origine", () => {
    const exported = toExportableWorkflow(raw);
    for (const key of ['id', 'active', 'versionId', 'createdAt', 'meta']) {
      expect(exported).not.toHaveProperty(key);
    }
  });

  it('garde le travail : nom, nœuds, câblage, réglages', () => {
    const exported = toExportableWorkflow(raw);
    expect(exported.name).toBe('Facturation client');
    expect(exported.nodes).toEqual(raw.nodes);
    expect(exported.connections).toEqual(raw.connections);
    expect(exported.settings).toEqual({ executionOrder: 'v1' });
  });

  it('ne garde des tags que le nom', () => {
    expect(toExportableWorkflow(raw).tags).toEqual([{ name: 'prod' }]);
    expect(toExportableWorkflow({ ...raw, tags: ['prod'] }).tags).toEqual([{ name: 'prod' }]);
    expect(toExportableWorkflow({ ...raw, tags: [] })).not.toHaveProperty('tags');
  });

  it('exclut les données épinglées sauf demande explicite', () => {
    expect(toExportableWorkflow(raw)).not.toHaveProperty('pinData');
    expect(toExportableWorkflow(raw, { includePinData: true }).pinData).toEqual(raw.pinData);
    expect(toExportableWorkflow({ ...raw, pinData: {} }, { includePinData: true })).not.toHaveProperty(
      'pinData',
    );
  });

  it('conserve les champs inconnus plutôt que de les perdre', () => {
    const exported = toExportableWorkflow({ ...raw, futureField: 42 } as unknown as N8nWorkflow);
    expect(exported.futureField).toBe(42);
  });

  it('supporte un workflow vide', () => {
    const exported = toExportableWorkflow({ name: 'Vide' } as N8nWorkflow);
    expect(exported).toEqual({ name: 'Vide', nodes: [], connections: {}, settings: {} });
  });
});

describe('workflowExportText', () => {
  it('rend un JSON indenté et relisible', () => {
    const text = workflowExportText(raw);
    expect(text).toContain('\n  "name": "Facturation client"');
    expect(JSON.parse(text).nodes).toHaveLength(1);
  });
});

describe('workflowExportFileName', () => {
  it('slugifie le nom du workflow', () => {
    expect(workflowExportFileName('Facturation Client — Prod')).toBe('facturation-client-prod.json');
    expect(workflowExportFileName('Résumé hebdo')).toBe('resume-hebdo.json');
    expect(workflowExportFileName('***')).toBe('workflow.json');
  });
});
