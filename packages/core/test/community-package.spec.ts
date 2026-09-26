import { describe, expect, it } from 'vitest';
import { communityPackagesOf, isCommunityNodeType, nodePackageOf } from '../src/domain/n8n/node-type-name';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';

describe('nodePackageOf', () => {
  it('rend le paquet npm d’un type non scopé', () => {
    expect(nodePackageOf('n8n-nodes-evolution-api.evolutionApi')).toBe('n8n-nodes-evolution-api');
  });

  it('garde le scope d’un paquet scopé', () => {
    expect(nodePackageOf('@devlikeapro/n8n-nodes-waha.WAHA')).toBe('@devlikeapro/n8n-nodes-waha');
  });

  it('coupe au DERNIER point : un nom de paquet peut en porter', () => {
    expect(nodePackageOf('n8n-nodes-foo.js.fooNode')).toBe('n8n-nodes-foo.js');
  });

  it('rend null sur un type sans paquet', () => {
    expect(nodePackageOf('slack')).toBeNull();
    expect(nodePackageOf('.slack')).toBeNull();
  });
});

describe('isCommunityNodeType', () => {
  it('écarte les paquets livrés avec n8n', () => {
    expect(isCommunityNodeType('n8n-nodes-base.slack')).toBe(false);
    expect(isCommunityNodeType('@n8n/n8n-nodes-langchain.agent')).toBe(false);
  });

  it('reconnaît un paquet communautaire', () => {
    expect(isCommunityNodeType('n8n-nodes-evolution-api.evolutionApi')).toBe(true);
  });
});

describe('communityPackagesOf', () => {
  it('liste une fois chaque paquet communautaire du workflow, avec ses types', () => {
    const workflow = {
      name: 'x',
      nodes: [
        { name: 'A', type: 'n8n-nodes-base.set', parameters: {} },
        { name: 'B', type: 'n8n-nodes-evolution-api.evolutionApi', parameters: {} },
        { name: 'C', type: 'n8n-nodes-evolution-api.evolutionApi', parameters: {} },
        { name: 'D', type: 'n8n-nodes-evolution-api.evolutionApiTrigger', parameters: {} },
      ],
      connections: {},
    } as unknown as N8nWorkflow;
    expect(communityPackagesOf(workflow)).toEqual([
      {
        packageName: 'n8n-nodes-evolution-api',
        nodeTypes: ['n8n-nodes-evolution-api.evolutionApi', 'n8n-nodes-evolution-api.evolutionApiTrigger'],
      },
    ]);
  });
});
