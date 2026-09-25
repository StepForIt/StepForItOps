import { describe, expect, it } from 'vitest';
import { blueprintExportText, blueprintModuleCount } from '../src/domain/make/blueprint-export';

const blueprint = {
  name: 'Sync CRM',
  flow: [
    { id: 1, module: 'gateway:CustomWebHook', parameters: { __IMTHOOK__: 812 } },
    {
      id: 2,
      module: 'builtin:BasicRouter',
      routes: [{ flow: [{ id: 3, module: 'google-sheets:addRow', parameters: { __IMTCONN__: 42 } }] }],
    },
  ],
  metadata: { instant: true, version: 1 },
};

describe('blueprintExportText', () => {
  it('rend le blueprint tel quel, indenté : c est ce que Make réimporte', () => {
    const text = blueprintExportText(blueprint);

    expect(JSON.parse(text)).toEqual(blueprint);
    expect(text).toContain('\n  "flow"');
  });

  it('refuse un contenu qui n est pas un blueprint plutôt que d exporter du vide', () => {
    expect(() => blueprintExportText({ nodes: [], connections: {} })).toThrow(/blueprint Make/);
    expect(() => blueprintExportText(null)).toThrow(/blueprint Make/);
  });
});

describe('blueprintModuleCount', () => {
  it('compte les modules imbriqués dans les routes', () => {
    expect(blueprintModuleCount(blueprint)).toBe(3);
  });

  it('rend zéro sur un contenu illisible, sans lever', () => {
    expect(blueprintModuleCount({ nodes: [] })).toBe(0);
  });
});
