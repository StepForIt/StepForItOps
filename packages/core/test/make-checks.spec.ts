import { describe, expect, it } from 'vitest';
import { runMakeChecks } from '../src/domain/make/make-checks';

const codes = (blueprint: Parameters<typeof runMakeChecks>[0]) => runMakeChecks(blueprint).map((f) => f.code);

describe('références entre modules', () => {
  it('se tait sur un scénario sain', () => {
    expect(
      codes({
        flow: [
          { id: 1, module: 'gateway:CustomWebHook' },
          { id: 2, module: 'slack:sendMessage', mapper: { text: '{{1.body}}' } },
        ],
      }),
    ).toEqual([]);
  });

  it('signale en erreur un renvoi vers un module qui n existe pas', () => {
    const findings = runMakeChecks({
      flow: [
        { id: 1, module: 'gateway:CustomWebHook' },
        { id: 2, module: 'slack:sendMessage', mapper: { text: '{{9.body}}' } },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('make-ref-unknown');
    expect(findings[0].severity).toBe('error');
  });

  it('signale un renvoi vers un module PLUS LOIN dans le flow : il n aura pas tourné', () => {
    expect(
      codes({
        flow: [
          { id: 1, module: 'gateway:CustomWebHook' },
          { id: 2, module: 'slack:sendMessage', mapper: { text: '{{3.body}}' } },
          { id: 3, module: 'http:ActionSendData' },
        ],
      }),
    ).toEqual(['make-ref-unreachable']);
  });

  it('signale un renvoi d une route vers sa sœur, que Make n exécute jamais ensemble', () => {
    expect(
      codes({
        flow: [
          { id: 1, module: 'gateway:CustomWebHook' },
          {
            id: 2,
            module: 'builtin:BasicRouter',
            routes: [
              { flow: [{ id: 3, module: 'http:ActionSendData' }] },
              { flow: [{ id: 4, module: 'slack:sendMessage', mapper: { text: '{{3.body}}' } }] },
            ],
          },
        ],
      }),
    ).toEqual(['make-ref-unreachable']);
  });

  it('accepte qu une route lise ce qui précède le routeur', () => {
    expect(
      codes({
        flow: [
          { id: 1, module: 'gateway:CustomWebHook' },
          {
            id: 2,
            module: 'builtin:BasicRouter',
            routes: [{ flow: [{ id: 3, module: 'slack:sendMessage', mapper: { text: '{{1.body}}' } }] }],
          },
        ],
      }),
    ).toEqual([]);
  });
});

describe('agrégateur et itérateur', () => {
  const feeder = { id: 2, module: 'builtin:BasicFeeder', mapper: { array: '{{1.items}}' } };

  it('accepte un agrégateur rattaché à son itérateur', () => {
    expect(
      codes({
        flow: [
          { id: 1, module: 'gateway:CustomWebHook' },
          feeder,
          { id: 3, module: 'builtin:BasicAggregator', parameters: { feeder: 2 } },
        ],
      }),
    ).toEqual([]);
  });

  it('signale en erreur le `feeder` posé à la racine du module, que Make ignore en silence', () => {
    const findings = runMakeChecks({
      flow: [
        { id: 1, module: 'gateway:CustomWebHook' },
        feeder,
        { id: 3, module: 'builtin:BasicAggregator', feeder: 2 } as never,
      ],
    });
    expect(findings[0].code).toBe('make-aggregator-no-feeder');
    expect(findings[0].message).toMatch(/racine du module/);
  });

  it('signale un agrégateur sans source du tout', () => {
    expect(codes({ flow: [{ id: 1, module: 'builtin:BasicAggregator' }] })).toEqual([
      'make-aggregator-no-feeder',
    ]);
  });

  it('signale un agrégateur rattaché à un module qui n itère rien', () => {
    expect(
      codes({
        flow: [
          { id: 1, module: 'gateway:CustomWebHook' },
          { id: 2, module: 'builtin:BasicAggregator', parameters: { feeder: 1 } },
        ],
      }),
    ).toEqual(['make-aggregator-bad-feeder']);
  });
});

describe('If/Else et Merge', () => {
  const branches = [
    { type: 'condition', flow: [{ id: 3, module: 'slack:sendMessage' }] },
    { type: 'else', flow: [{ id: 4, module: 'http:ActionSendData' }] },
  ];

  it('accepte un If/Else immédiatement suivi de son Merge, filtres comptés juste', () => {
    expect(
      codes({
        flow: [
          { id: 1, module: 'gateway:CustomWebHook' },
          { id: 2, module: 'builtin:BasicIfElse', branches },
          { id: 5, module: 'builtin:BasicMerge', parameters: { filters: [null, null] } },
        ],
      }),
    ).toEqual([]);
  });

  it('signale en erreur un If/Else sans Merge : tout ce qui suit ne s exécutera jamais', () => {
    expect(
      codes({
        flow: [
          { id: 1, module: 'gateway:CustomWebHook' },
          { id: 2, module: 'builtin:BasicIfElse', branches },
        ],
      }),
    ).toEqual(['make-ifelse-without-merge']);
  });

  it('signale un décompte de filtres qui ne colle pas au nombre de branches', () => {
    expect(
      codes({
        flow: [
          { id: 1, module: 'gateway:CustomWebHook' },
          { id: 2, module: 'builtin:BasicIfElse', branches },
          { id: 5, module: 'builtin:BasicMerge', parameters: { filters: [null] } },
        ],
      }),
    ).toEqual(['make-merge-filters-mismatch']);
  });

  it('contrôle aussi les If/Else imbriqués dans une route', () => {
    expect(
      codes({
        flow: [
          {
            id: 1,
            module: 'builtin:BasicRouter',
            routes: [{ flow: [{ id: 2, module: 'builtin:BasicIfElse', branches: [] }] }],
          },
        ],
      }),
    ).toEqual(['make-ifelse-without-merge']);
  });
});

describe('secrets et gabarits', () => {
  it('signale une clé en clair', () => {
    expect(
      codes({
        flow: [
          {
            id: 1,
            module: 'http:ActionSendData',
            mapper: { token: 'sk-ant-abcdefghijklmnopqrstuvwxyz012345' },
          },
        ],
      }),
    ).toEqual(['make-secret-in-clear']);
  });

  it('ne crie pas au secret sur une expression : la valeur vient de la connexion', () => {
    expect(
      codes({ flow: [{ id: 1, module: 'http:ActionSendData', mapper: { token: '{{1.token}}' } }] }),
    ).toEqual([]);
  });

  it('distingue un gabarit jamais rempli d une fuite : ce n est pas la même alerte', () => {
    expect(
      codes({ flow: [{ id: 1, module: 'http:ActionSendData', mapper: { key: 'YOUR_API_KEY' } }] }),
    ).toEqual(['make-placeholder']);
  });
});
