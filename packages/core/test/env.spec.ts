import { describe, expect, it } from 'vitest';
import { DEFAULT_ENVS, normalizeEnvs, slugifyEnvId } from '../src/domain/env';

describe('slugifyEnvId', () => {
  it('borne un id à ce qui passe dans un tag, un nom et une URL', () => {
    expect(slugifyEnvId('Recette Client')).toBe('recette-client');
    expect(slugifyEnvId('  Préprod !! ')).toBe('preprod');
  });
});

describe('normalizeEnvs', () => {
  it('garde dev en tête et prod en queue, même absents de la déclaration', () => {
    expect(normalizeEnvs([{ id: 'recette' }]).map((env) => env.id)).toEqual(['dev', 'recette', 'prod']);
  });

  it('retombe sur la déclaration par défaut plutôt que sur rien', () => {
    expect(normalizeEnvs(null)).toEqual(DEFAULT_ENVS);
    expect(normalizeEnvs([])).toEqual(DEFAULT_ENVS);
  });

  it('reprend une ancienne chaîne de simples ids', () => {
    expect(normalizeEnvs(['dev', 'prod']).map((env) => [env.id, env.after])).toEqual([
      ['dev', null],
      ['prod', 'dev'],
    ]);
  });

  it('ne coche rien sur un env créé, tout sur la prod', () => {
    const [, recette, prod] = normalizeEnvs([{ id: 'dev' }, { id: 'recette' }, { id: 'prod' }]);
    expect([recette.monitored, recette.canonicalWebhookPath]).toEqual([false, false]);
    expect([prod.monitored, prod.canonicalWebhookPath]).toEqual([true, true]);
  });

  it('rattache un amont inconnu ou circulaire au précédent', () => {
    const envs = normalizeEnvs([
      { id: 'dev' },
      { id: 'recette', after: 'fantome' },
      { id: 'prod', after: 'prod' },
    ]);
    expect(envs.map((env) => env.after)).toEqual([null, 'dev', 'recette']);
  });

  it('écarte les doublons et les ids vides', () => {
    expect(normalizeEnvs([{ id: 'dev' }, { id: 'DEV' }, { id: '  ' }]).map((e) => e.id)).toEqual([
      'dev',
      'prod',
    ]);
  });
});
