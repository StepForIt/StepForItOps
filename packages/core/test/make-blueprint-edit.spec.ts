import { describe, expect, it } from 'vitest';
import { MakeBlueprint, MakeModule, flattenModules } from '../src/domain/make/blueprint';
import {
  BlueprintEditError,
  applyBlueprintEdits,
  summarizeMakeOperations,
} from '../src/domain/make/blueprint-edit';
import { diffBlueprintsForReview } from '../src/domain/make/blueprint-review-diff';
import { evaluateMakeProposalGate } from '../src/domain/make/make-proposal-gate';

const http = (id: number, over: Partial<MakeModule> = {}): MakeModule => ({
  id,
  module: 'http:ActionSendData',
  parameters: { __IMTCONN__: 42 },
  mapper: { url: 'https://crm.test', method: 'get', headers: [{ name: 'X-Trace', value: 'a' }] },
  metadata: { designer: { x: 0, y: 0 } },
  ...over,
});

const scenario = (): MakeBlueprint => ({
  name: 'Sync CRM',
  flow: [
    http(1),
    {
      id: 2,
      module: 'builtin:BasicRouter',
      routes: [
        { flow: [http(3, { mapper: { url: 'https://a.test', body: '{{1.data}}' } })] },
        { flow: [http(4)] },
      ],
    },
  ],
  metadata: { scenario: { maxErrors: 3 } },
});

const find = (blueprint: MakeBlueprint, id: number) =>
  flattenModules(blueprint).find((flat) => flat.module.id === id)?.module;

describe('applyBlueprintEdits', () => {
  it('fusionne le mapper en profondeur : seules les clés données changent', () => {
    const { blueprint } = applyBlueprintEdits(scenario(), [
      { type: 'set-module-mapper', moduleId: 1, mapper: { method: 'post' } },
    ]);

    expect(find(blueprint, 1)?.mapper).toEqual({
      url: 'https://crm.test',
      method: 'post',
      headers: [{ name: 'X-Trace', value: 'a' }],
    });
  });

  it('retouche un module imbriqué dans une route, sans toucher l original', () => {
    const original = scenario();

    const { blueprint } = applyBlueprintEdits(original, [
      { type: 'set-module-parameters', moduleId: 3, parameters: { timeout: 30 } },
      { type: 'rename-module', moduleId: 3, name: 'Envoyer au CRM' },
    ]);

    expect(find(blueprint, 3)?.parameters).toEqual({ __IMTCONN__: 42, timeout: 30 });
    expect(find(blueprint, 3)?.metadata?.designer?.name).toBe('Envoyer au CRM');
    expect(find(original, 3)?.parameters).toEqual({ __IMTCONN__: 42 });
  });

  it('retire un champ par chemin, index de tableau compris', () => {
    const { blueprint, warnings } = applyBlueprintEdits(scenario(), [
      { type: 'remove-module-field', moduleId: 1, section: 'mapper', path: 'headers.0' },
      { type: 'remove-module-field', moduleId: 1, section: 'mapper', path: 'absent' },
    ]);

    expect(find(blueprint, 1)?.mapper?.headers).toEqual([]);
    expect(warnings).toEqual(['« mapper.absent » était déjà absent du module #1.']);
  });

  it('supprime un routeur avec ce qu il porte, en le disant', () => {
    const { blueprint, warnings } = applyBlueprintEdits(scenario(), [{ type: 'remove-module', moduleId: 2 }]);

    expect(flattenModules(blueprint).map((flat) => flat.module.id)).toEqual([1]);
    expect(warnings[0]).toMatch(/2 module\(s\)/);
  });

  it('pose et retire un filtre', () => {
    const filter = {
      name: 'Clients actifs',
      conditions: [[{ a: '{{1.status}}', o: 'text:equal', b: 'active' }]],
    };
    const set = applyBlueprintEdits(scenario(), [{ type: 'set-module-filter', moduleId: 3, filter }]);
    const removed = applyBlueprintEdits(set.blueprint, [
      { type: 'set-module-filter', moduleId: 3, filter: null },
    ]);

    expect(find(set.blueprint, 3)?.filter).toEqual(filter);
    expect(find(removed.blueprint, 3)?.filter).toBeUndefined();
    expect(removed.warnings[0]).toMatch(/tous les bundles/);
  });

  it('refuse d ajouter un module, en le disant au modèle', () => {
    expect(() => applyBlueprintEdits(scenario(), [{ type: 'add-module', moduleId: 9 }])).toThrow(
      /Ajouter un module ou une route n'est pas possible/,
    );
  });

  it('refuse de toucher une connexion du compte, à n importe quelle profondeur', () => {
    expect(() =>
      applyBlueprintEdits(scenario(), [
        { type: 'set-module-parameters', moduleId: 1, parameters: { __IMTCONN__: 7 } },
      ]),
    ).toThrow(/__IMT/);
    expect(() =>
      applyBlueprintEdits(scenario(), [
        { type: 'remove-module-field', moduleId: 1, section: 'parameters', path: '__IMTCONN__' },
      ]),
    ).toThrow(/__IMT/);
  });

  it('refuse d écrire une valeur masquée : le masque partirait dans Make à la place du secret', () => {
    expect(() =>
      applyBlueprintEdits(scenario(), [
        {
          type: 'set-module-mapper',
          moduleId: 1,
          mapper: { headers: [{ name: 'Authorization', value: '[secret masqué sk-…]' }] },
        },
      ]),
    ).toThrow(/valeur masquée/);
  });

  it('refuse tout le lot sur un module inconnu, et une opération mal formée', () => {
    expect(() =>
      applyBlueprintEdits(scenario(), [
        { type: 'rename-module', moduleId: 1, name: 'Ok' },
        { type: 'rename-module', moduleId: 99, name: 'Disparu' },
      ]),
    ).toThrow(/#99/);
    expect(() =>
      applyBlueprintEdits(scenario(), [{ type: 'set-module-mapper', moduleId: 1, mapper: {} }]),
    ).toThrow(BlueprintEditError);
    expect(() =>
      applyBlueprintEdits(scenario(), [{ type: 'rename-module', moduleId: '1', name: 'x' }]),
    ).toThrow(/id entier/);
  });
});

describe('summarizeMakeOperations', () => {
  it('compte les modules touchés par geste', () => {
    expect(
      summarizeMakeOperations([
        { type: 'set-module-mapper', moduleId: 1, mapper: { a: 1 } },
        { type: 'set-module-filter', moduleId: 1, filter: null },
        { type: 'rename-module', moduleId: 3, name: 'x' },
      ]),
    ).toBe('Scénario : 1 module modifié, 1 module renommé');
  });
});

describe('diffBlueprintsForReview', () => {
  it('lit un renommage comme un renommage, sans changement d enchaînement', () => {
    const { blueprint } = applyBlueprintEdits(scenario(), [
      { type: 'rename-module', moduleId: 1, name: 'Lire le CRM' },
    ]);

    const diff = diffBlueprintsForReview(scenario(), blueprint);

    expect(diff.counts).toEqual({ added: 0, removed: 0, modified: 0, renamed: 1 });
    expect(diff.nodes[0]).toMatchObject({
      name: 'Lire le CRM (#1)',
      renamedFrom: 'http:ActionSendData (#1)',
    });
    expect(diff.connections.changed).toBe(false);
  });

  it('ne marque pas le routeur quand seule sa route change, et annonce un filtre retiré', () => {
    const filtered = applyBlueprintEdits(scenario(), [
      { type: 'set-module-filter', moduleId: 3, filter: { name: 'f', conditions: [] } },
    ]).blueprint;
    const { blueprint } = applyBlueprintEdits(filtered, [
      { type: 'set-module-filter', moduleId: 3, filter: null },
    ]);

    const diff = diffBlueprintsForReview(filtered, blueprint);

    expect(diff.nodes.map((node) => node.name)).toEqual(['http:ActionSendData (#3)']);
    expect(diff.nodes[0].explanations.map((e) => e.text)).toContain(
      'Filtre retiré : le module traitera tous les bundles.',
    );
  });

  it('dit une suppression et le changement d enchaînement qu elle produit', () => {
    const { blueprint } = applyBlueprintEdits(scenario(), [{ type: 'remove-module', moduleId: 4 }]);

    const diff = diffBlueprintsForReview(scenario(), blueprint);

    expect(diff.counts.removed).toBe(1);
    expect(diff.connections.changed).toBe(true);
    expect(diff.hasChanges).toBe(true);
  });
});

describe('evaluateMakeProposalGate', () => {
  it('bloque une erreur INTRODUITE : un module supprimé dont un autre lit la sortie', () => {
    const { blueprint } = applyBlueprintEdits(scenario(), [{ type: 'remove-module', moduleId: 1 }]);

    const gate = evaluateMakeProposalGate(scenario(), blueprint, { env: 'dev', active: false });

    expect(gate.blocked).toBe(true);
    expect(gate.introduced.map((finding) => finding.code)).toContain('make-ref-unknown');
  });

  it('laisse passer une retouche sans faute introduite, et cède à force', () => {
    const renamed = applyBlueprintEdits(scenario(), [
      { type: 'rename-module', moduleId: 1, name: 'Lire' },
    ]).blueprint;
    const broken = applyBlueprintEdits(scenario(), [{ type: 'remove-module', moduleId: 1 }]).blueprint;

    expect(evaluateMakeProposalGate(scenario(), renamed, { env: 'prod', active: true }).blocked).toBe(false);
    expect(
      evaluateMakeProposalGate(scenario(), broken, { env: 'dev', active: false, force: true }).blocked,
    ).toBe(false);
  });
});
