import { describe, expect, it } from 'vitest';
import { flattenModules, isMakeBlueprint, moduleLabel, moduleStrings } from '../src/domain/make/blueprint';

const blueprint = {
  name: 'Sync',
  flow: [
    { id: 1, module: 'gateway:CustomWebHook' },
    {
      id: 2,
      module: 'builtin:BasicRouter',
      routes: [
        { flow: [{ id: 3, module: 'slack:sendMessage', mapper: { text: '{{1.body}}' } }] },
        { flow: [{ id: 4, module: 'google-sheets:addRow' }] },
      ],
    },
    { id: 5, module: 'http:ActionSendData' },
  ],
};

describe('flattenModules', () => {
  it('descend dans les routes : un contrôle arrêté au premier niveau ne verrait pas la moitié du scénario', () => {
    expect(flattenModules(blueprint).map((f) => f.module.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('dit d où vient chaque module', () => {
    const byId = new Map(flattenModules(blueprint).map((f) => [f.module.id, f]));
    expect(byId.get(3)?.scope).toBe('route');
    expect(byId.get(3)?.parentId).toBe(2);
    expect(byId.get(5)?.scope).toBe('main');
  });

  it('donne à chaque module ce qui a FORCÉMENT tourné avant lui, ancêtres compris', () => {
    const byId = new Map(flattenModules(blueprint).map((f) => [f.module.id, f]));
    expect(byId.get(3)?.upstreamIds).toEqual([1, 2]);
    expect(byId.get(5)?.upstreamIds).toEqual([1, 2]);
  });

  it("n'ouvre jamais une route sur sa sœur : c'est ce qui rend une référence croisée fautive", () => {
    const byId = new Map(flattenModules(blueprint).map((f) => [f.module.id, f]));
    expect(byId.get(4)?.upstreamIds).not.toContain(3);
  });

  it('descend aussi dans les branches d un If/Else et dans les gestionnaires d erreur', () => {
    const nested = {
      flow: [
        { id: 1, module: 'gateway:CustomWebHook' },
        {
          id: 2,
          module: 'builtin:BasicIfElse',
          branches: [{ flow: [{ id: 3, module: 'slack:sendMessage' }] }],
        },
        { id: 4, module: 'http:ActionSendData', onerror: [{ id: 5, module: 'builtin:Break' }] },
      ],
    };
    const flat = flattenModules(nested);
    expect(flat.map((f) => f.module.id)).toEqual([1, 2, 3, 4, 5]);
    expect(flat.find((f) => f.module.id === 5)?.scope).toBe('onerror');
  });
});

describe('moduleLabel', () => {
  it('préfère le nom posé par un humain', () => {
    expect(
      moduleLabel({ id: 1, module: 'slack:sendMessage', metadata: { designer: { name: 'Alerte #ops' } } }),
    ).toBe('Alerte #ops');
  });

  it('retombe sur le type, puis sur l id : un id nu ne dit rien à qui lit un finding', () => {
    expect(moduleLabel({ id: 7, module: 'slack:sendMessage' })).toBe('slack:sendMessage');
    expect(moduleLabel({ id: 7 })).toBe('#7');
  });
});

describe('moduleStrings', () => {
  it('ramasse les chaînes en profondeur, mapper et parameters confondus', () => {
    const values = moduleStrings({
      id: 1,
      mapper: { body: { nested: ['{{2.email}}'] } },
      parameters: { url: 'https://x.test' },
    });
    expect(values).toContain('{{2.email}}');
    expect(values).toContain('https://x.test');
  });
});

describe('isMakeBlueprint', () => {
  it('reconnaît un blueprint à son flow', () => {
    expect(isMakeBlueprint({ flow: [] })).toBe(true);
    expect(isMakeBlueprint({ nodes: [], connections: {} })).toBe(false);
    expect(isMakeBlueprint(null)).toBe(false);
  });
});
