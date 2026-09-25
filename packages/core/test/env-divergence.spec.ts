import { describe, expect, it } from 'vitest';
import { envDivergence, isToDeploy, matchesDivergenceFilter } from '../src/domain/env-divergence';

const at = (day: number) => new Date(Date.UTC(2026, 8, day));

describe('envDivergence', () => {
  it('à jour quand la clé égale celle de la prod', () => {
    const result = envDivergence([
      { id: 'd', env: 'dev', key: 'k', updatedAt: at(2) },
      { id: 'p', env: 'prod', key: 'k', updatedAt: at(1) },
    ]);
    expect(result.get('d')?.status).toBe('in-sync');
    expect(result.has('p')).toBe(false);
  });

  it('à déployer quand l’exemplaire a bougé après la prod', () => {
    const result = envDivergence([
      { id: 'd', env: 'dev', key: 'k2', updatedAt: at(3) },
      { id: 'pp', env: 'preprod', key: 'k1', updatedAt: at(1) },
      { id: 'p', env: 'prod', key: 'k1', updatedAt: at(2) },
    ]);
    expect(result.get('d')?.status).toBe('ahead');
    expect(result.get('pp')?.status).toBe('in-sync');
    expect(isToDeploy('ahead')).toBe(true);
  });

  it('prod modifiée en dernier : pas à déployer', () => {
    const result = envDivergence([
      { id: 'd', env: 'dev', key: 'k1', updatedAt: at(1) },
      { id: 'p', env: 'prod', key: 'k2', updatedAt: at(2) },
    ]);
    expect(result.get('d')?.status).toBe('behind');
    expect(isToDeploy('behind')).toBe(false);
  });

  it('jamais déployé sans exemplaire de prod', () => {
    const result = envDivergence([{ id: 'd', env: 'dev', key: 'k', updatedAt: at(1) }]);
    expect(result.get('d')?.status).toBe('not-deployed');
  });

  it('deux prods : à jour seulement si les deux sont égales', () => {
    const result = envDivergence([
      { id: 'd', env: 'dev', key: 'k', updatedAt: at(3) },
      { id: 'p1', env: 'prod', key: 'k', updatedAt: at(1) },
      { id: 'p2', env: 'prod', key: 'old', updatedAt: at(1) },
    ]);
    expect(result.get('d')?.status).toBe('ahead');
  });

  it('inconnu quand une empreinte manque, sans statut pour l’env non déduit', () => {
    const result = envDivergence([
      { id: 'd', env: 'dev', key: null, updatedAt: at(1) },
      { id: 'x', env: null, key: 'k', updatedAt: at(1) },
      { id: 'p', env: 'prod', key: 'k', updatedAt: at(1) },
    ]);
    expect(result.get('d')?.status).toBe('unknown');
    expect(result.has('x')).toBe(false);
  });
});

describe('matchesDivergenceFilter', () => {
  const ahead = { status: 'ahead' as const, referenceEnv: 'prod', referenceIds: ['p'] };
  it('un env = ses exemplaires à déployer, et eux seuls', () => {
    expect(matchesDivergenceFilter('dev', 'dev', ahead)).toBe(true);
    expect(matchesDivergenceFilter('preprod', 'dev', ahead)).toBe(false);
    expect(matchesDivergenceFilter('dev', 'dev', { ...ahead, status: 'behind' })).toBe(false);
  });
  it('diverged ne compte pas un exemplaire jamais déployé', () => {
    expect(matchesDivergenceFilter('diverged', 'dev', { ...ahead, status: 'not-deployed' })).toBe(false);
    expect(matchesDivergenceFilter('diverged', 'dev', { ...ahead, status: 'behind' })).toBe(true);
  });
});
