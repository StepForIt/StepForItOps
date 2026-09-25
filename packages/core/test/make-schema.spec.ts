import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flattenModules } from '../src/domain/make/blueprint';
import { runMakeChecks } from '../src/domain/make/make-checks';
import { runMakeSchemaChecks } from '../src/domain/make/make-schema';

const codes = (blueprint: Parameters<typeof runMakeChecks>[0]) =>
  runMakeSchemaChecks(flattenModules(blueprint)).map((f) => f.code);

/** Un module HTTP décrit comme Make le décrit vraiment (cf. la fixture). */
const httpModule = (
  over: { mapper?: Record<string, unknown>; parameters?: Record<string, unknown> } = {},
) => ({
  id: 3,
  module: 'http:DownloadFile',
  version: 4,
  parameters: { authenticationType: 'noAuth', ...over.parameters },
  mapper: { url: 'https://x.test', stopOnHttpError: true, ...over.mapper },
  metadata: {
    designer: { x: 0, y: 0 },
    parameters: [
      {
        name: 'authenticationType',
        type: 'select',
        label: 'Authentication type',
        required: true,
        validate: { enum: ['noAuth', 'apiKey', 'basicAuth', 'oAuth'] },
      },
    ],
    expect: [
      { name: 'url', type: 'url', label: 'URL', required: true },
      {
        name: 'stopOnHttpError',
        type: 'boolean',
        label: 'Return error if HTTP request fails',
        required: true,
      },
      { name: 'headers', type: 'array', label: 'Headers' },
    ],
  },
});

describe('conformité au schéma embarqué', () => {
  it('se tait sur un module conforme', () => {
    expect(codes({ flow: [httpModule()] })).toEqual([]);
  });

  it('signale un champ que le module ne connaît pas : Make l ignore, la valeur n arrive jamais', () => {
    expect(codes({ flow: [httpModule({ mapper: { timeoutt: 30 } })] })).toEqual(['make-unknown-field']);
  });

  it('signale en erreur un champ requis sans valeur', () => {
    const findings = runMakeSchemaChecks(flattenModules({ flow: [httpModule({ mapper: { url: '' } })] }));
    expect(findings.map((f) => f.code)).toEqual(['make-required-field-missing']);
    expect(findings[0].severity).toBe('error');
  });

  it('signale en erreur une valeur hors des choix admis, et dit lesquels', () => {
    const findings = runMakeSchemaChecks(
      flattenModules({ flow: [httpModule({ parameters: { authenticationType: 'bearer' } })] }),
    );
    expect(findings[0].code).toBe('make-value-not-allowed');
    expect(findings[0].message).toMatch(/noAuth/);
  });

  it('signale un type qui ne colle pas', () => {
    expect(codes({ flow: [httpModule({ mapper: { stopOnHttpError: 'oui' } })] })).toEqual([
      'make-field-type',
    ]);
  });

  it('ne juge PAS une valeur qui porte une expression : elle vient d ailleurs', () => {
    expect(codes({ flow: [httpModule({ mapper: { stopOnHttpError: '{{2.flag}}' } })] })).toEqual([]);
    expect(codes({ flow: [httpModule({ parameters: { authenticationType: '{{2.auth}}' } })] })).toEqual([]);
  });

  it('ignore les clés que Make gère lui-même', () => {
    expect(codes({ flow: [httpModule({ parameters: { __IMTCONN__: 42 } })] })).toEqual([]);
  });

  it('ne dit RIEN d un module sans description : un trou de la description n est pas une faute', () => {
    expect(codes({ flow: [{ id: 1, module: 'x:y', mapper: { nimporte: 'quoi' } }] })).toEqual([]);
  });

  it('ne juge que les types dont l écart a une conséquence', () => {
    // `url` est un texte libre : y mettre autre chose ne veut rien dire de sûr.
    expect(codes({ flow: [httpModule({ mapper: { url: 12 } })] })).toEqual([]);
  });
});

describe('un blueprint réel, exporté depuis Make', () => {
  const blueprint = JSON.parse(
    readFileSync(join(__dirname, 'fixtures/make-webhook-http.blueprint.json'), 'utf8'),
  );

  it('ne produit aucun finding : le premier devoir d un contrôle est de se taire quand tout va bien', () => {
    expect(runMakeChecks(blueprint)).toEqual([]);
  });

  it('se lit entièrement', () => {
    expect(flattenModules(blueprint).map((f) => f.module.module)).toEqual([
      'gateway:CustomWebHook',
      'http:DownloadFile',
    ]);
  });
});
