import { describe, expect, it } from 'vitest';
import {
  chooseCredential,
  collectCredentials,
  credentialTypesForNode,
  credentialsPatch,
} from '../src/domain/n8n/instance-credentials';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';

function node(name: string, type: string, credentials?: Record<string, { id: string; name: string }>) {
  return { id: name, name, type, typeVersion: 1, position: [0, 0], parameters: {}, credentials };
}

function wf(...nodes: ReturnType<typeof node>[]): N8nWorkflow {
  return { id: 'w', name: 'W', nodes, connections: {} } as unknown as N8nWorkflow;
}

const NOTION_A = { notionApi: { id: 'n1', name: 'Notion prod' } };
const NOTION_B = { notionApi: { id: 'n2', name: 'Notion bac à sable' } };

describe('collectCredentials', () => {
  it('relève chaque credential une fois et compte ses usages', () => {
    const refs = collectCredentials([
      wf(node('A', 'n8n-nodes-base.notion', NOTION_A), node('B', 'n8n-nodes-base.notion', NOTION_A)),
      wf(node('C', 'n8n-nodes-base.notion', NOTION_B)),
    ]);
    expect(refs).toEqual([
      { type: 'notionApi', id: 'n1', name: 'Notion prod', uses: 2 },
      { type: 'notionApi', id: 'n2', name: 'Notion bac à sable', uses: 1 },
    ]);
  });

  it('ignore un nœud sans credentials', () => {
    expect(collectCredentials([wf(node('A', 'n8n-nodes-base.set'))])).toEqual([]);
  });
});

describe('credentialTypesForNode', () => {
  it('apprend le type attendu des nœuds de même type déjà en place', () => {
    const workflows = [
      wf(
        node('A', 'n8n-nodes-base.notion', NOTION_A),
        node('B', 'n8n-nodes-base.openAi', { openAiApi: { id: 'o1', name: 'OpenAI' } }),
      ),
    ];
    expect(credentialTypesForNode(workflows, 'n8n-nodes-base.notion')).toEqual(['notionApi']);
    expect(credentialTypesForNode(workflows, 'n8n-nodes-base.openAi')).toEqual(['openAiApi']);
  });

  it('ne répond rien pour un type jamais vu', () => {
    expect(credentialTypesForNode([wf(node('A', 'n8n-nodes-base.set'))], 'n8n-nodes-base.slack')).toEqual([]);
  });
});

describe('chooseCredential', () => {
  const available = collectCredentials([
    wf(node('A', 'n8n-nodes-base.notion', NOTION_A), node('B', 'n8n-nodes-base.notion', NOTION_A)),
    wf(node('C', 'n8n-nodes-base.notion', NOTION_B)),
  ]);

  it('retient la plus employée et annonce les autres', () => {
    const choice = chooseCredential(available, 'notionApi');
    expect(choice.chosen?.name).toBe('Notion prod');
    expect(choice.alternatives.map((alt) => alt.name)).toEqual(['Notion bac à sable']);
  });

  it('ne retient rien quand l’instance n’en connaît aucune', () => {
    expect(chooseCredential(available, 'slackApi')).toEqual({
      type: 'slackApi',
      chosen: undefined,
      alternatives: [],
    });
  });

  it('n’a rien à arbitrer quand elle est seule de son type', () => {
    const seule = collectCredentials([wf(node('A', 'n8n-nodes-base.notion', NOTION_A))]);
    expect(chooseCredential(seule, 'notionApi').alternatives).toEqual([]);
  });
});

describe('credentialsPatch', () => {
  it('rend le bloc n8n, en sautant ce qui n’a pas pu être choisi', () => {
    const patch = credentialsPatch([
      {
        type: 'notionApi',
        chosen: { type: 'notionApi', id: 'n1', name: 'Notion prod', uses: 2 },
        alternatives: [],
      },
      { type: 'slackApi', alternatives: [] },
    ]);
    expect(patch).toEqual({ notionApi: { id: 'n1', name: 'Notion prod' } });
  });
});
