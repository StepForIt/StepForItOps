import { describe, expect, it } from 'vitest';
import {
  MakeScenario,
  readBlueprint,
  toScenarioUpdate,
  toWorkflowSummary,
  usedModuleTypes,
} from '../src/domain/make/scenario';

const scenario = (over: Partial<MakeScenario> = {}): MakeScenario => ({
  id: 4210,
  name: 'Sync CRM',
  isActive: true,
  lastEdit: '2026-09-01T10:00:00.000Z',
  ...over,
});

describe('toWorkflowSummary', () => {
  it('rend l id du scénario en chaîne : le miroir stocke des externalId textuels', () => {
    expect(toWorkflowSummary(scenario()).externalId).toBe('4210');
  });

  it('ne compte comme actif qu un scénario actif ET non mis en pause', () => {
    expect(toWorkflowSummary(scenario()).active).toBe(true);
    expect(toWorkflowSummary(scenario({ isPaused: true })).active).toBe(false);
    expect(toWorkflowSummary(scenario({ isActive: false })).active).toBe(false);
  });

  it('porte lastEdit en changedAt : c est ce qui évite de retélécharger un blueprint inchangé', () => {
    expect(toWorkflowSummary(scenario()).changedAt).toBe('2026-09-01T10:00:00.000Z');
  });

  it('ne rend jamais de contenu : Make ne le donne pas avec la liste', () => {
    expect(toWorkflowSummary(scenario()).raw).toBeUndefined();
  });

  it('range le dossier dans les tags, et dédoublonne avec les labels', () => {
    const s = scenario({ folderPath: 'CRM/cleanup' });
    expect(toWorkflowSummary(s, ['prod']).tags).toEqual(['prod', 'CRM/cleanup']);
    expect(toWorkflowSummary(s, ['CRM/cleanup']).tags).toEqual(['CRM/cleanup']);
  });

  it('ne déclare JAMAIS archivé : Make n a pas d archivage, et un scénario en pause est un workflow éteint, pas rangé', () => {
    expect(toWorkflowSummary(scenario({ isPaused: true })).archivedUpstream).toBe(false);
    expect(toWorkflowSummary(scenario({ concept: true })).archivedUpstream).toBe(false);
  });
});

describe('readBlueprint', () => {
  it('sort le blueprint de son enveloppe', () => {
    expect(readBlueprint({ code: 'ok', response: { blueprint: { name: 'X', flow: [] } } })).toEqual({
      name: 'X',
      flow: [],
    });
  });

  it('lève plutôt que de rendre du vide : un contenu vide écraserait la sauvegarde en base', () => {
    expect(() => readBlueprint({})).toThrow(/illisible/);
    expect(() => readBlueprint({ response: {} })).toThrow(/illisible/);
  });

  it('accepte un blueprint vide mais présent', () => {
    expect(readBlueprint({ response: { blueprint: {} } })).toEqual({});
  });
});

describe('usedModuleTypes', () => {
  it('donne l inventaire des modules sans télécharger le blueprint', () => {
    expect(
      usedModuleTypes(
        scenario({
          usedModules: [
            { packageName: 'google-sheets', moduleName: 'addRow' },
            { packageName: 'builtin', moduleName: 'BasicRouter' },
          ],
        }),
      ),
    ).toEqual(['google-sheets:addRow', 'builtin:BasicRouter']);
  });

  it('ne rend rien quand le listing ne dit rien', () => {
    expect(usedModuleTypes(scenario())).toEqual([]);
  });
});

describe('toScenarioUpdate', () => {
  it('sérialise le blueprint : l API Make l attend en chaîne', () => {
    const blueprint = { name: 'Sync CRM', flow: [{ id: 1, module: 'json:ParseJSON' }], metadata: {} };

    const update = toScenarioUpdate(blueprint);

    expect(typeof update.blueprint).toBe('string');
    expect(JSON.parse(update.blueprint)).toEqual(blueprint);
  });

  it('remet le nom de la version : Make le range hors du blueprint', () => {
    expect(toScenarioUpdate({ name: 'Ancien nom', flow: [] }).name).toBe('Ancien nom');
    expect(toScenarioUpdate({ flow: [] })).not.toHaveProperty('name');
  });

  it('refuse un contenu qui n est pas un blueprint plutôt que de vider le scénario', () => {
    expect(() => toScenarioUpdate({ nodes: [], connections: {} })).toThrow(/blueprint Make/);
    expect(() => toScenarioUpdate(null)).toThrow(/blueprint Make/);
  });
});
