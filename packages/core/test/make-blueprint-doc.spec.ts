import { describe, expect, it } from 'vitest';
import { MakeBlueprint } from '../src/domain/make/blueprint';
import { blueprintDocContext } from '../src/domain/make/blueprint-doc';

const blueprint: MakeBlueprint = {
  name: 'Sync CRM',
  flow: [
    {
      id: 1,
      module: 'http:ActionSendData',
      mapper: {
        headers: [{ name: 'Authorization', value: 'Bearer sk-ant-api03-abcdefghijklmnopqrstuvwxyz' }],
      },
      metadata: { designer: { name: 'Lire contacts' } },
    },
    {
      id: 2,
      module: 'builtin:BasicRouter',
      routes: [
        { flow: [{ id: 3, module: 'google-sheets:addRow' }] },
        { flow: [{ id: 4, module: 'slack:CreateMessage' }] },
      ],
    },
  ],
  metadata: {},
};

describe('blueprintDocContext', () => {
  it('rend les modules à plat, routes comprises, avec leur libellé', () => {
    const context = blueprintDocContext(blueprint, 'Nom du miroir');

    expect(context.name).toBe('Sync CRM');
    expect(context.modules.map((m) => [m.id, m.name])).toEqual([
      [1, 'Lire contacts'],
      [2, 'builtin:BasicRouter'],
      [3, 'google-sheets:addRow'],
      [4, 'slack:CreateMessage'],
    ]);
  });

  it('rend les liens explicites : deux routes sœurs partent du routeur, jamais l une de l autre', () => {
    const { links } = blueprintDocContext(blueprint, 'x');

    expect(links).toEqual([
      { from: 1, to: 2 },
      { from: 2, to: 3, label: 'route 1' },
      { from: 2, to: 4, label: 'route 2' },
    ]);
  });

  it('masque les secrets avant qu ils ne partent vers l IA', () => {
    expect(JSON.stringify(blueprintDocContext(blueprint, 'x'))).not.toContain(
      'sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
    );
  });

  it('retombe sur le nom du miroir et un contexte vide pour un contenu illisible', () => {
    expect(blueprintDocContext({ nodes: [] }, 'Nom du miroir')).toEqual({
      name: 'Nom du miroir',
      modules: [],
      links: [],
    });
  });
});
