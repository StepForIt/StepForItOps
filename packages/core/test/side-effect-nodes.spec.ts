import { describe, expect, it } from 'vitest';
import { detectSideEffects } from '../src/domain/n8n/side-effect-nodes';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';

function workflowWith(nodes: Array<Record<string, unknown>>): N8nWorkflow {
  return { name: 'WF', nodes, connections: {} } as unknown as N8nWorkflow;
}

describe('side-effect-nodes', () => {
  it('repère un envoi de mail et un message', () => {
    const found = detectSideEffects(
      workflowWith([
        { name: 'Envoyer facture', type: 'n8n-nodes-base.gmail', parameters: {} },
        { name: 'Prévenir l’équipe', type: 'n8n-nodes-base.slack', parameters: {} },
      ]),
    );
    expect(found.map((n) => n.kind)).toEqual(['email', 'message']);
  });

  it('distingue un HTTP qui lit d’un HTTP qui écrit', () => {
    const found = detectSideEffects(
      workflowWith([
        { name: 'Lire', type: 'n8n-nodes-base.httpRequest', parameters: { url: 'https://x' } },
        {
          name: 'Créer',
          type: 'n8n-nodes-base.httpRequest',
          parameters: { url: 'https://x', method: 'POST' },
        },
      ]),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ nodeName: 'Créer', kind: 'http-write' });
  });

  it('repère une écriture de données quel que soit le provider', () => {
    const found = detectSideEffects(
      workflowWith([
        { name: 'Chercher', type: 'n8n-nodes-base.nocoDb', parameters: { operation: 'getAll' } },
        { name: 'Ajouter', type: 'n8n-nodes-base.airtable', parameters: { operation: 'create' } },
      ]),
    );
    expect(found.map((n) => n.nodeName)).toEqual(['Ajouter']);
  });

  it('compte l’appel de sous-workflow, pas son trigger', () => {
    const found = detectSideEffects(
      workflowWith([
        { name: 'Appeler', type: 'n8n-nodes-base.executeWorkflow', parameters: { workflowId: 'x' } },
        { name: 'Entrée', type: 'n8n-nodes-base.executeWorkflowTrigger', parameters: {} },
      ]),
    );
    expect(found).toEqual([
      {
        nodeName: 'Appeler',
        type: 'n8n-nodes-base.executeWorkflow',
        kind: 'sub-workflow',
        reason: 'exécute un autre workflow',
      },
    ]);
  });

  it('ignore un nœud désactivé, et un paramètre que la config courante masque', () => {
    const found = detectSideEffects(
      workflowWith([
        { name: 'Mail coupé', type: 'n8n-nodes-base.gmail', parameters: {}, disabled: true },
        // sendBody: false ⇒ bodyParameters est inerte, mais method reste actif
        {
          name: 'Lecture',
          type: 'n8n-nodes-base.httpRequest',
          parameters: { url: 'https://x', sendBody: false },
        },
      ]),
    );
    expect(found).toEqual([]);
  });
});
