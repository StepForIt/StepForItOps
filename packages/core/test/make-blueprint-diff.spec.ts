import { describe, expect, it } from 'vitest';
import { MakeBlueprint, MakeModule } from '../src/domain/make/blueprint';
import { diffBlueprints } from '../src/domain/make/blueprint-diff';

const mod = (id: number, over: Partial<MakeModule> = {}): MakeModule => ({
  id,
  module: 'http:ActionSendData',
  version: 3,
  mapper: { url: `https://api.example.test/${id}` },
  ...over,
});

const blueprint = (flow: MakeModule[], metadata: Record<string, unknown> = {}): MakeBlueprint => ({
  name: 'Sync CRM',
  flow,
  metadata,
});

describe('diffBlueprints', () => {
  it('apparie les modules par id : ajoutés, supprimés, modifiés', () => {
    const current = blueprint([mod(1), mod(2)]);
    const restored = blueprint([mod(1, { mapper: { url: 'https://autre.test' } }), mod(3)]);

    const { modules } = diffBlueprints(current, restored);

    expect(modules.current).toBe(2);
    expect(modules.restored).toBe(2);
    expect(modules.added).toEqual(['http:ActionSendData']);
    expect(modules.removed).toEqual(['http:ActionSendData']);
    expect(modules.modified).toHaveLength(1);
  });

  it('compte les modules imbriqués dans les routes', () => {
    const router = mod(1, {
      module: 'builtin:BasicRouter',
      routes: [{ flow: [mod(2)] }, { flow: [mod(3)] }],
    });

    expect(diffBlueprints(blueprint([]), blueprint([router])).modules.restored).toBe(3);
  });

  it('ne déclare pas modifié un routeur dont seule une route a changé', () => {
    const route = (url: string) => [{ flow: [mod(2, { mapper: { url } })] }];
    const current = blueprint([mod(1, { module: 'builtin:BasicRouter', routes: route('https://a.test') })]);
    const restored = blueprint([mod(1, { module: 'builtin:BasicRouter', routes: route('https://b.test') })]);

    expect(diffBlueprints(current, restored).modules.modified).toEqual(['http:ActionSendData']);
  });

  it('voit un module déplacé dans une autre route comme un changement de structure, pas de contenu', () => {
    const current = blueprint([mod(1, { routes: [{ flow: [mod(2)] }] }), mod(3)]);
    const restored = blueprint([mod(1, { routes: [{ flow: [mod(2), mod(3)] }] })]);

    const diff = diffBlueprints(current, restored);

    expect(diff.structureChanged).toBe(true);
    expect(diff.modules.modified).toEqual([]);
  });

  it('signale les connexions citées par la seule version restaurée', () => {
    const current = blueprint([mod(1, { parameters: { __IMTCONN__: 11 } })]);
    const restored = blueprint([
      mod(1, { parameters: { __IMTCONN__: 11 } }),
      mod(2, { parameters: { __IMTCONN__: 42 }, metadata: { designer: { name: 'Envoi CRM' } } }),
    ]);

    expect(diffBlueprints(current, restored).refsOnlyInRestored).toEqual([
      { key: '__IMTCONN__', id: '42', module: 'Envoi CRM' },
    ]);
  });

  it('distingue un changement de réglages du scénario', () => {
    const diff = diffBlueprints(
      blueprint([mod(1)], { scenario: { maxErrors: 3 } }),
      blueprint([mod(1)], { scenario: { maxErrors: 1 } }),
    );

    expect(diff.settingsChanged).toBe(true);
    expect(diff.structureChanged).toBe(false);
  });

  it('lit un contenu qui n est pas un blueprint comme vide, sans lever', () => {
    expect(diffBlueprints(null, { nodes: [] }).modules).toEqual({
      current: 0,
      restored: 0,
      added: [],
      removed: [],
      modified: [],
    });
  });
});
