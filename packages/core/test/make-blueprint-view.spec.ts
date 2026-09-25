import { describe, expect, it } from 'vitest';
import { makeMermaid, makeModuleEdges, makeScenarioUrl, makeStats } from '../src/domain/make/blueprint-view';

const blueprint = {
  flow: [
    { id: 1, module: 'gateway:CustomWebHook', metadata: { designer: { name: 'Webhook' } } },
    {
      id: 2,
      module: 'builtin:BasicRouter',
      routes: [
        { flow: [{ id: 3, module: 'slack:sendMessage' }] },
        { flow: [{ id: 4, module: 'google-sheets:addRow' }] },
      ],
    },
    { id: 5, module: 'http:ActionSendData', onerror: [{ id: 6, module: 'builtin:Break' }] },
  ],
};

describe('makeModuleEdges', () => {
  it('enchaîne les modules d un même flow', () => {
    expect(makeModuleEdges(blueprint)).toContainEqual({ fromId: 1, toId: 2 });
    expect(makeModuleEdges(blueprint)).toContainEqual({ fromId: 2, toId: 5 });
  });

  it('entre dans chaque route, en la nommant', () => {
    const edges = makeModuleEdges(blueprint);
    expect(edges).toContainEqual({ fromId: 2, toId: 3, label: 'route 1' });
    expect(edges).toContainEqual({ fromId: 2, toId: 4, label: 'route 2' });
  });

  it('montre le détour par le gestionnaire d erreur', () => {
    expect(makeModuleEdges(blueprint)).toContainEqual({ fromId: 5, toId: 6, label: 'erreur' });
  });

  it('nomme « sinon » la branche par défaut d un If/Else', () => {
    const edges = makeModuleEdges({
      flow: [
        {
          id: 1,
          module: 'builtin:BasicIfElse',
          branches: [
            { type: 'condition', flow: [{ id: 2, module: 'slack:sendMessage' }] },
            { type: 'else', flow: [{ id: 3, module: 'http:ActionSendData' }] },
          ],
        },
      ],
    });
    expect(edges).toContainEqual({ fromId: 1, toId: 3, label: 'sinon' });
  });
});

describe('makeMermaid', () => {
  it('rend un nœud par module et un lien par arête', () => {
    const mermaid = makeMermaid(blueprint);
    expect(mermaid).toMatch(/^graph TD/);
    expect(mermaid).toContain('m1["Webhook"]');
    expect(mermaid).toContain('m2 -->|route 1| m3');
  });

  it('entoure les modules signalés', () => {
    expect(makeMermaid(blueprint, new Map([[3, 'error']]))).toMatch(/style m3 stroke:#ff4d4f/);
  });

  it('neutralise les caractères qui referment un libellé : un nom de module vient de l utilisateur', () => {
    const mermaid = makeMermaid({ flow: [{ id: 1, metadata: { designer: { name: 'A ["b"] | c' } } }] });
    expect(mermaid).toContain('m1["A b c"]');
  });

  it('dit qu un scénario est vide plutôt que de rendre un graphe sans nœud', () => {
    expect(makeMermaid({ flow: [] })).toContain('Scénario sans module');
  });
});

describe('makeScenarioUrl', () => {
  it('vise la team, pas l organisation', () => {
    expect(makeScenarioUrl('eu1.make.com', '2648401', '4210')).toBe(
      'https://eu1.make.com/2648401/scenarios/4210/edit',
    );
  });

  it('ne fabrique aucun lien à défaut de zone ou de team : un lien faux mène ailleurs', () => {
    expect(makeScenarioUrl(null, '2648401', '4210')).toBe('');
    expect(makeScenarioUrl('eu1.make.com', null, '4210')).toBe('');
  });
});

describe('makeStats', () => {
  it('compte les modules imbriqués et leurs liens', () => {
    expect(makeStats(blueprint)).toEqual({ modules: 6, connections: 5 });
  });
});
