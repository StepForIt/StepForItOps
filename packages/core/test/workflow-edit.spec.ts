import { describe, expect, it } from 'vitest';
import { WorkflowEditError, applyEditOperations } from '../src/domain/n8n/workflow-edit';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';

/** Webhook → Code → Slack, chaîne linéaire. */
function chain(): N8nWorkflow {
  return {
    name: 'WF',
    nodes: [
      { id: 'a', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
      {
        id: 'b',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        position: [200, 0],
        parameters: { jsCode: 'return $("Webhook").all();', mode: 'runOnceForAllItems' },
      },
      { id: 'c', name: 'Slack', type: 'n8n-nodes-base.slack', position: [400, 0], parameters: {} },
    ],
    connections: {
      Webhook: { main: [[{ node: 'Code', type: 'main', index: 0 }]] },
      Code: { main: [[{ node: 'Slack', type: 'main', index: 0 }]] },
    },
  };
}

describe('applyEditOperations', () => {
  it('renomme un nœud sans casser connexions ni expressions', () => {
    const { workflow } = applyEditOperations(chain(), [
      { op: 'rename-node', node: 'Webhook', newName: 'Entrée commande' },
    ]);

    expect(workflow.nodes.map((node) => node.name)).toEqual(['Entrée commande', 'Code', 'Slack']);
    expect(workflow.connections['Entrée commande'].main[0][0].node).toBe('Code');
    expect(workflow.nodes[1].parameters?.jsCode).toBe('return $("Entrée commande").all();');
  });

  it('refuse un renommage qui crée un doublon', () => {
    expect(() =>
      applyEditOperations(chain(), [{ op: 'rename-node', node: 'Webhook', newName: 'Code' }]),
    ).toThrow(WorkflowEditError);
  });

  it('fusionne les paramètres avec patch et les remplace avec set', () => {
    const patched = applyEditOperations(chain(), [
      { op: 'patch-node-parameters', node: 'Code', parameters: { jsCode: 'return [];' } },
    ]).workflow;
    expect(patched.nodes[1].parameters).toEqual({ jsCode: 'return [];', mode: 'runOnceForAllItems' });

    const replaced = applyEditOperations(chain(), [
      { op: 'set-node-parameters', node: 'Code', parameters: { jsCode: 'return [];' } },
    ]).workflow;
    expect(replaced.nodes[1].parameters).toEqual({ jsCode: 'return [];' });
  });

  /** Le cas réel : un nœud Airtable dont `columns` porte un `schema` de 800 feuilles. */
  function mapper(): N8nWorkflow {
    const workflow = chain();
    workflow.nodes[2] = {
      ...workflow.nodes[2],
      parameters: {
        operation: 'update',
        columns: {
          mappingMode: 'defineBelow',
          value: { 'Product Link': '={{ $json.url }}', 'Product Link v2': '={{ $json.url }}' },
          schema: [
            { id: 'Product Link', type: 'string' },
            { id: 'Product Link v2', type: 'string' },
            ...Array.from({ length: 28 }, (_, index) => ({ id: `col${index}`, type: 'string' })),
          ],
        },
      },
    };
    return workflow;
  }

  it('patch fusionne en profondeur : une sous-clé touchée ne fait pas perdre ses sœurs', () => {
    const { workflow } = applyEditOperations(mapper(), [
      {
        op: 'patch-node-parameters',
        node: 'Slack',
        parameters: { columns: { value: { 'Product Link': '={{ $json.autre }}' } } },
      },
    ]);

    const columns = workflow.nodes[2].parameters?.columns as Record<string, unknown>;
    expect(columns.value).toEqual({
      'Product Link': '={{ $json.autre }}',
      'Product Link v2': '={{ $json.url }}',
    });
    expect((columns.schema as unknown[]).length).toBe(30);
    expect(columns.mappingMode).toBe('defineBelow');
  });

  it('retire une seule sous-clé sans toucher au schéma', () => {
    const { workflow, warnings } = applyEditOperations(mapper(), [
      { op: 'remove-node-parameter', node: 'Slack', path: ['columns', 'value', 'Product Link v2'] },
    ]);

    const columns = workflow.nodes[2].parameters?.columns as Record<string, unknown>;
    expect(columns.value).toEqual({ 'Product Link': '={{ $json.url }}' });
    expect((columns.schema as unknown[]).length).toBe(30);
    expect(warnings).toEqual([]);
  });

  it('marque la colonne retirée dans le schéma, pour que le refresh n8n ne la ramène pas', () => {
    const { workflow } = applyEditOperations(mapper(), [
      { op: 'remove-node-parameter', node: 'Slack', path: ['columns', 'value', 'Product Link v2'] },
    ]);

    const schema = (workflow.nodes[2].parameters?.columns as { schema: Record<string, unknown>[] }).schema;
    expect(schema.find((entry) => entry.id === 'Product Link v2')?.removed).toBe(true);
    expect(schema.find((entry) => entry.id === 'Product Link')?.removed).toBeUndefined();
    expect(schema.length).toBe(30);
  });

  it('accepte un chemin en notation pointée, index de tableau compris', () => {
    const { workflow } = applyEditOperations(mapper(), [
      { op: 'remove-node-parameter', node: 'Slack', path: 'columns.schema[0]' },
    ]);

    const columns = workflow.nodes[2].parameters?.columns as Record<string, unknown>;
    expect((columns.schema as { id: string }[])[0].id).toBe('Product Link v2');
  });

  it('refuse un chemin qui ne mène nulle part', () => {
    expect(() =>
      applyEditOperations(mapper(), [
        { op: 'remove-node-parameter', node: 'Slack', path: ['columns', 'value', 'Inconnu'] },
      ]),
    ).toThrow(WorkflowEditError);
  });

  it('avertit quand un nœud perd un bloc entier de paramètres', () => {
    const { warnings } = applyEditOperations(mapper(), [
      {
        op: 'set-node-parameters',
        node: 'Slack',
        parameters: { operation: 'update', columns: { value: { 'Product Link': '={{ $json.url }}' } } },
      },
    ]);

    expect(warnings.some((warning) => /« Slack » perd \d+ paramètres/.test(warning))).toBe(true);
  });

  it('recoud la chaîne quand un nœud du milieu est supprimé', () => {
    const { workflow } = applyEditOperations(chain(), [{ op: 'remove-node', node: 'Code' }]);

    expect(workflow.nodes.map((node) => node.name)).toEqual(['Webhook', 'Slack']);
    expect(workflow.connections.Webhook.main[0]).toEqual([{ node: 'Slack', type: 'main', index: 0 }]);
    expect(workflow.connections.Code).toBeUndefined();
  });

  it('insère un nœud dans la chaîne avec `after`', () => {
    const { workflow } = applyEditOperations(chain(), [
      {
        op: 'add-node',
        after: 'Webhook',
        node: { name: 'Filtre', type: 'n8n-nodes-base.filter', parameters: {} },
      },
    ]);

    expect(workflow.connections.Webhook.main[0]).toEqual([{ node: 'Filtre', type: 'main', index: 0 }]);
    expect(workflow.connections.Filtre.main[0]).toEqual([{ node: 'Code', type: 'main', index: 0 }]);
    expect(workflow.nodes.find((node) => node.name === 'Filtre')?.position).toEqual([220, 0]);
  });

  it('insère un nœud dans la chaîne avec `before`', () => {
    const { workflow } = applyEditOperations(chain(), [
      {
        op: 'add-node',
        before: 'Slack',
        node: { name: 'Filtre', type: 'n8n-nodes-base.filter', parameters: {} },
      },
    ]);

    expect(workflow.connections.Code.main[0]).toEqual([{ node: 'Filtre', type: 'main', index: 0 }]);
    expect(workflow.connections.Filtre.main[0]).toEqual([{ node: 'Slack', type: 'main', index: 0 }]);
  });

  it('signale un nœud ajouté sans connexion', () => {
    const { warnings } = applyEditOperations(chain(), [
      { op: 'add-node', node: { name: 'Isolé', type: 'n8n-nodes-base.noOp' } },
    ]);
    expect(warnings.some((warning) => warning.includes('Isolé'))).toBe(true);
  });

  it('alerte quand le déclencheur disparaît', () => {
    const { warnings } = applyEditOperations(chain(), [{ op: 'remove-node', node: 'Webhook' }]);
    expect(warnings.some((warning) => warning.includes('déclencheur'))).toBe(true);
  });

  it('connecte et déconnecte deux nœuds', () => {
    const connected = applyEditOperations(chain(), [
      { op: 'connect', from: 'Webhook', to: 'Slack' },
    ]).workflow;
    expect(connected.connections.Webhook.main[0]).toHaveLength(2);

    const disconnected = applyEditOperations(connected, [
      { op: 'disconnect', from: 'Webhook', to: 'Slack' },
    ]).workflow;
    expect(disconnected.connections.Webhook.main[0]).toEqual([{ node: 'Code', type: 'main', index: 0 }]);
  });

  it('refuse une opération portant sur un nœud inexistant, sans rien modifier', () => {
    const original = chain();
    expect(() =>
      applyEditOperations(original, [{ op: 'set-node-notes', node: 'Fantôme', notes: 'x' }]),
    ).toThrow(/Fantôme/);
    expect(original).toEqual(chain());
  });

  it('nettoie une connexion pendante préexistante au lieu de refuser l’édition', () => {
    const broken = chain();
    broken.connections['Airtable update'] = { main: [[{ node: 'Slack', type: 'main', index: 0 }]] };
    broken.connections.Code.main[0].push({ node: 'Fantôme', type: 'main', index: 0 });

    const { workflow, warnings } = applyEditOperations(broken, [
      { op: 'set-node-parameters', node: 'Code', parameters: { jsCode: 'return [];' } },
    ]);

    expect(workflow.nodes[1].parameters).toEqual({ jsCode: 'return [];' });
    expect(workflow.connections['Airtable update']).toBeUndefined();
    expect(workflow.connections.Code.main[0]).toEqual([{ node: 'Slack', type: 'main', index: 0 }]);
    expect(warnings.some((warning) => warning.includes('Airtable update'))).toBe(true);
    expect(warnings.some((warning) => warning.includes('Fantôme'))).toBe(true);
  });

  it('ne décale pas les sorties d’un If quand une branche est vidée', () => {
    const wf = chain();
    wf.connections.Code.main = [
      [{ node: 'Parti', type: 'main', index: 0 }],
      [{ node: 'Slack', type: 'main', index: 0 }],
    ];

    const { workflow } = applyEditOperations(wf, [{ op: 'set-workflow-name', name: 'X' }]);

    expect(workflow.connections.Code.main).toEqual([[], [{ node: 'Slack', type: 'main', index: 0 }]]);
  });

  it('applique les opérations dans l’ordre', () => {
    const { workflow } = applyEditOperations(chain(), [
      { op: 'rename-node', node: 'Code', newName: 'Transformation' },
      { op: 'set-node-notes', node: 'Transformation', notes: 'Normalise la commande' },
      { op: 'set-workflow-name', name: 'Commandes v2' },
    ]);

    expect(workflow.name).toBe('Commandes v2');
    const node = workflow.nodes.find((n) => n.name === 'Transformation');
    expect(node?.notes).toBe('Normalise la commande');
    expect(node?.notesInFlow).toBe(false);
  });
});
