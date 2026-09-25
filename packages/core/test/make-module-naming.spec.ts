import { describe, expect, it } from 'vitest';
import { MakeBlueprint, MakeModule, flattenModules } from '../src/domain/make/blueprint';
import { findMakeNamingIssues, renameModules, unnamedModules } from '../src/domain/make/module-naming';

const named = (id: number, name: string, over: Partial<MakeModule> = {}): MakeModule => ({
  id,
  module: 'http:ActionSendData',
  mapper: { url: `https://api.example.test/${id}` },
  metadata: { designer: { x: id * 100, y: 0, name } },
  ...over,
});
const unnamed = (id: number, over: Partial<MakeModule> = {}): MakeModule => ({
  id,
  module: 'http:ActionSendData',
  mapper: { url: `https://api.example.test/${id}` },
  metadata: { designer: { x: id * 100, y: 0 } },
  ...over,
});

const blueprint = (flow: MakeModule[]): MakeBlueprint => ({ name: 'Sync CRM', flow, metadata: {} });

describe('unnamedModules', () => {
  it('trouve les modules sans nom, jusque dans les routes', () => {
    const router = named(1, 'Aiguillage', {
      module: 'builtin:BasicRouter',
      mapper: undefined,
      routes: [{ flow: [unnamed(2), named(3, 'Envoi CRM')] }],
    });

    expect(unnamedModules(blueprint([router, unnamed(4)])).map((flat) => flat.module.id)).toEqual([2, 4]);
  });

  it('tient un nom fait d espaces pour une absence de nom', () => {
    expect(unnamedModules(blueprint([named(1, '   ')]))).toHaveLength(1);
  });
});

describe('findMakeNamingIssues', () => {
  it('signale un module sans nom avec son id, sous le code du naming n8n', () => {
    const [finding] = findMakeNamingIssues(blueprint([unnamed(7)]));

    expect(finding).toMatchObject({ code: 'default-name', severity: 'warning', data: { moduleId: 7 } });
    expect(finding.message).toContain('#7');
  });

  it('signale les modules identiques, mais jamais des routeurs sans réglage', () => {
    const same = { mapper: { url: 'https://same.test' } };
    const routers = [
      named(3, 'R1', { module: 'builtin:BasicRouter', mapper: undefined }),
      named(4, 'R2', { module: 'builtin:BasicRouter', mapper: undefined }),
    ];

    const duplicates = findMakeNamingIssues(
      blueprint([named(1, 'A', same), named(2, 'B', same), ...routers]),
    ).filter((finding) => finding.code === 'duplicate-nodes');

    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].data).toMatchObject({ moduleIds: [1, 2] });
  });

  it('ne dit rien d un contenu qui n est pas un blueprint', () => {
    expect(findMakeNamingIssues({ nodes: [] })).toEqual([]);
  });
});

describe('renameModules', () => {
  it('pose le nom dans metadata.designer sans toucher la position ni l original', () => {
    const original = blueprint([unnamed(1), named(2, 'Garder')]);

    const renamed = renameModules(original, [{ moduleId: 1, newName: '  Récupérer commandes  ' }]);

    expect(renamed.flow?.[0].metadata?.designer).toEqual({ x: 100, y: 0, name: 'Récupérer commandes' });
    expect(renamed.flow?.[1].metadata?.designer?.name).toBe('Garder');
    expect(original.flow?.[0].metadata?.designer?.name).toBeUndefined();
  });

  it('renomme un module imbriqué dans une route', () => {
    const renamed = renameModules(blueprint([named(1, 'R', { routes: [{ flow: [unnamed(2)] }] })]), [
      { moduleId: 2, newName: 'Dans la route' },
    ]);

    expect(
      flattenModules(renamed).find((flat) => flat.module.id === 2)?.module.metadata?.designer?.name,
    ).toBe('Dans la route');
  });

  it('ne touche à aucune expression : elles visent l id, pas le nom', () => {
    const consumer = unnamed(2, { mapper: { email: '{{1.email}}' } });

    const renamed = renameModules(blueprint([unnamed(1), consumer]), [
      { moduleId: 1, newName: 'Lire contact' },
    ]);

    expect(renamed.flow?.[1].mapper).toEqual({ email: '{{1.email}}' });
  });

  it('refuse tout le lot quand un id n existe plus, plutôt que de renommer à moitié', () => {
    expect(() =>
      renameModules(blueprint([unnamed(1)]), [
        { moduleId: 1, newName: 'Ok' },
        { moduleId: 99, newName: 'Disparu' },
      ]),
    ).toThrow(/#99/);
  });

  it('refuse un nom vide', () => {
    expect(() => renameModules(blueprint([unnamed(1)]), [{ moduleId: 1, newName: '  ' }])).toThrow(/vide/);
  });
});
