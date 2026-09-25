import { describe, expect, it } from 'vitest';
import { checkParamShapes, collectShapes, findShapeMismatches } from '../src/domain/n8n/param-shape';
import { N8nNode, N8nWorkflow } from '../src/domain/n8n/workflow.types';

const NOTION = 'n8n-nodes-base.notion';

function node(name: string, parameters: Record<string, unknown>, type = NOTION): N8nNode {
  return { id: name, name, type, typeVersion: 2, position: [0, 0], parameters } as N8nNode;
}

function wf(...nodes: N8nNode[]): N8nWorkflow {
  return { id: 'w', name: 'W', nodes, connections: {} } as N8nWorkflow;
}

/** Forme correcte, telle que l'éditeur n8n l'écrit. */
const bonneForme = (name: string) =>
  node(name, {
    resource: 'databasePage',
    operation: 'update',
    propertiesUi: {
      propertyValues: [{ key: 'Images|files', fileUrls: { values: [{ url: '=x', name: 'image.png' }] } }],
    },
  });

describe('collectShapes', () => {
  it('relève le genre de chaque chemin et compte ses témoins', () => {
    const reference = collectShapes([wf(bonneForme('A'), bonneForme('B'))], NOTION);
    expect(reference.nodes).toBe(2);
    expect(reference.paths.get('propertiesUi.propertyValues[].fileUrls')).toEqual(new Map([['object', 2]]));
  });

  it('ignore les nœuds d’un autre type', () => {
    const reference = collectShapes([wf(node('X', { a: 1 }, 'n8n-nodes-base.set'))], NOTION);
    expect(reference.nodes).toBe(0);
  });
});

describe('findShapeMismatches', () => {
  const corpus = [wf(bonneForme('A'), bonneForme('B'), bonneForme('C'))];
  const reference = collectShapes(corpus, NOTION);

  it('attrape le fileUrls passé en chaîne', () => {
    const fautif = node('Notion - Upsert post (carrousel)', {
      resource: 'databasePage',
      operation: 'update',
      propertiesUi: {
        propertyValues: [{ key: 'Images|files', fileUrls: '={{$json.images_finales.map(i => i)}}' }],
      },
    });
    const [mismatch] = findShapeMismatches(reference, fautif);
    expect(mismatch).toMatchObject({
      path: 'propertiesUi.propertyValues[].fileUrls',
      found: 'string',
      expected: 'object',
      witnesses: 3,
    });
  });

  it('ne dit rien de la forme conforme', () => {
    expect(findShapeMismatches(reference, bonneForme('D'))).toEqual([]);
  });

  it('se tait sous le seuil de témoins : un nœud isolé n’impose pas sa forme', () => {
    const maigre = collectShapes([wf(bonneForme('A'), bonneForme('B'))], NOTION);
    const fautif = node('Z', {
      propertiesUi: { propertyValues: [{ fileUrls: '=x' }] },
    });
    expect(findShapeMismatches(maigre, fautif)).toEqual([]);
  });

  it('se tait quand le chemin accepte déjà deux formes', () => {
    const mixte = collectShapes(
      [
        wf(
          bonneForme('A'),
          bonneForme('B'),
          bonneForme('C'),
          node('D', { propertiesUi: { propertyValues: [{ fileUrls: '=déjà une chaîne' }] } }),
        ),
      ],
      NOTION,
    );
    const fautif = node('Z', { propertiesUi: { propertyValues: [{ fileUrls: '=x' }] } });
    expect(findShapeMismatches(mixte, fautif)).toEqual([]);
  });

  it('ignore un chemin que la référence ne connaît pas', () => {
    expect(findShapeMismatches(reference, node('Z', { toutNeuf: 'x' }))).toEqual([]);
  });
});

describe('checkParamShapes', () => {
  it('rend un finding warning, nommant le nœud et le chemin', () => {
    const references = new Map([
      [NOTION, collectShapes([wf(bonneForme('A'), bonneForme('B'), bonneForme('C'))], NOTION)],
    ]);
    const candidat = wf(
      node('Upsert carrousel', {
        propertiesUi: { propertyValues: [{ fileUrls: '=x' }] },
      }),
    );
    const [finding] = checkParamShapes(candidat, references);
    expect(finding.severity).toBe('warning');
    expect(finding.code).toBe('param-shape');
    expect(finding.nodeName).toBe('Upsert carrousel');
    expect(finding.message).toContain('une chaîne');
    expect(finding.message).toContain('un objet');
  });
});
