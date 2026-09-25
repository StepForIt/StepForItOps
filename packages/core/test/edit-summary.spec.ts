import { describe, expect, it } from 'vitest';
import { summarizeEditOperations } from '../src/domain/n8n/edit-summary';

describe('summarizeEditOperations', () => {
  it('nomme le nœud touché', () => {
    expect(
      summarizeEditOperations([
        { op: 'patch-node-parameters', node: 'Code - Fusionner images', parameters: {} },
      ]),
    ).toBe('Paramètres de « Code - Fusionner images »');
  });

  it('cite la première opération et compte les autres au-delà de deux', () => {
    expect(
      summarizeEditOperations([
        { op: 'add-node', node: { name: 'HTTP Request', type: 'n8n-nodes-base.httpRequest' } },
        { op: 'connect', from: 'A', to: 'HTTP Request' },
        { op: 'set-workflow-name', name: 'X' },
      ]),
    ).toBe('Ajout de « HTTP Request » (+2 autres)');
  });

  it('ne rend jamais un titre vide', () => {
    expect(summarizeEditOperations([])).toBe('Modification proposée');
  });
});
