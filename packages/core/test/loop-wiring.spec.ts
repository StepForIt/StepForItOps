import { describe, expect, it } from 'vitest';
import { runLoopWiringChecks } from '../src/domain/n8n/loop-wiring';
import { N8nConnections, N8nNode, N8nWorkflow } from '../src/domain/n8n/workflow.types';

function wf(nodes: Array<Partial<N8nNode>>, connections: N8nConnections): N8nWorkflow {
  return {
    name: 'Test',
    nodes: nodes.map((n, i) => ({
      name: n.name ?? `Node ${i}`,
      type: n.type ?? 'n8n-nodes-base.noOp',
      ...n,
    })),
    connections,
  };
}

const LOOP: Partial<N8nNode> = {
  name: 'Loop Over Items',
  type: 'n8n-nodes-base.splitInBatches',
  typeVersion: 3,
};

/** connections[from].main[index] = [{ node, … }] */
function main(...outputs: Array<string[]>): N8nConnections[string] {
  return { main: outputs.map((targets) => targets.map((node) => ({ node, type: 'main', index: 0 }))) };
}

describe('runLoopWiringChecks', () => {
  it('ne dit rien sur une boucle bien câblée', () => {
    const findings = runLoopWiringChecks(
      wf([{ name: 'Start' }, LOOP, { name: 'Traiter' }, { name: 'Suite' }], {
        Start: main(['Loop Over Items']),
        'Loop Over Items': main(['Suite'], ['Traiter']),
        Traiter: main(['Loop Over Items']),
      }),
    );
    expect(findings).toEqual([]);
  });

  it('signale le corps branché sur « done »', () => {
    const findings = runLoopWiringChecks(
      wf([LOOP, { name: 'Traiter' }], {
        'Loop Over Items': main(['Traiter']),
        Traiter: main(['Loop Over Items']),
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('loop-body-on-done');
    expect(findings[0].severity).toBe('error');
    expect(findings[0].nodeName).toBe('Loop Over Items');
  });

  it('signale la boucle qui ne se referme pas', () => {
    const findings = runLoopWiringChecks(
      wf([LOOP, { name: 'Traiter' }, { name: 'Suite' }], {
        'Loop Over Items': main(['Suite'], ['Traiter']),
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('loop-not-closed');
    expect(findings[0].data?.suggestion).toContain('Loop Over Items');
  });

  it('accepte un retour à plusieurs nœuds de distance', () => {
    const findings = runLoopWiringChecks(
      wf([LOOP, { name: 'A' }, { name: 'B' }, { name: 'C' }], {
        'Loop Over Items': main([], ['A']),
        A: main(['B']),
        B: main(['C']),
        C: main(['Loop Over Items']),
      }),
    );
    expect(findings).toEqual([]);
  });

  it('juge la sortie unique des versions antérieures à la v3', () => {
    const closed = wf([{ ...LOOP, typeVersion: 2 }, { name: 'Traiter' }], {
      'Loop Over Items': main(['Traiter']),
      Traiter: main(['Loop Over Items']),
    });
    expect(runLoopWiringChecks(closed)).toEqual([]);

    const open = wf([{ ...LOOP, typeVersion: 2 }, { name: 'Traiter' }], {
      'Loop Over Items': main(['Traiter']),
    });
    expect(runLoopWiringChecks(open).map((f) => f.code)).toEqual(['loop-not-closed']);
  });

  it('ignore une boucle désactivée ou sans aucune sortie branchée', () => {
    expect(runLoopWiringChecks(wf([{ ...LOOP, disabled: true }, { name: 'Traiter' }], {}))).toEqual([]);
    expect(runLoopWiringChecks(wf([LOOP], {}))).toEqual([]);
  });
});
