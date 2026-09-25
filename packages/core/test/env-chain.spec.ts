import { describe, expect, it } from 'vitest';
import { envChainPlan, envsFromChain, isDownstreamEnv, envLineage, nextEnv } from '../src/domain/env-chain';
import { normalizeEnvs } from '../src/domain/env';

const chain = (...ids: string[]) => envsFromChain(ids);
const full = chain('dev', 'preprod', 'prod');

describe('envsFromChain', () => {
  it('turns a linear chain into a lineage', () => {
    expect(full.map((env) => [env.id, env.after])).toEqual([
      ['dev', null],
      ['preprod', 'dev'],
      ['prod', 'preprod'],
    ]);
  });
});

describe('envChainPlan', () => {
  it('lists the steps up to the target, target included', () => {
    expect(envChainPlan(full, 'dev', 'prod')).toEqual({
      direction: 'forward',
      steps: ['preprod', 'prod'],
      skipped: ['preprod'],
    });
  });

  it('skips nothing when the step is the next one', () => {
    expect(envChainPlan(full, 'dev', 'preprod')).toEqual({
      direction: 'forward',
      steps: ['preprod'],
      skipped: [],
    });
  });

  it('does not blame an env nobody declared', () => {
    expect(envChainPlan(chain('dev', 'prod'), 'dev', 'prod')).toEqual({
      direction: 'forward',
      steps: ['prod'],
      skipped: [],
    });
  });

  it('says nothing when an env cannot be situated', () => {
    expect(envChainPlan(full, null, 'prod').direction).toBe('unknown');
    expect(envChainPlan(chain('dev', 'prod'), 'dev', 'preprod').direction).toBe('unknown');
  });

  it('owes nothing between two sibling branches', () => {
    // recette et preprod repartent toutes deux de dev : ni l'une ni l'autre n'est
    // une étape de la promotion de sa sœur.
    const branched = normalizeEnvs([
      { id: 'dev' },
      { id: 'preprod', after: 'dev' },
      { id: 'recette', after: 'dev' },
      { id: 'prod', after: 'preprod' },
    ]);
    expect(envChainPlan(branched, 'recette', 'preprod').direction).toBe('unknown');
    expect(envChainPlan(branched, 'dev', 'recette')).toEqual({
      direction: 'forward',
      steps: ['recette'],
      skipped: [],
    });
    expect(envLineage(branched, 'prod')).toEqual(['dev', 'preprod', 'prod']);
  });

  it('names a rollback for what it is', () => {
    expect(envChainPlan(full, 'prod', 'dev')).toEqual({
      direction: 'backward',
      steps: [],
      skipped: [],
    });
    expect(envChainPlan(full, 'dev', 'dev').direction).toBe('same');
  });
});

describe('isDownstreamEnv', () => {
  it('spares the env where the work happens', () => {
    expect(isDownstreamEnv(full, 'dev')).toBe(false);
    expect(isDownstreamEnv(full, 'preprod')).toBe(true);
    expect(isDownstreamEnv(full, 'prod')).toBe(true);
  });

  it('governs neither an unknown env nor an undeclared one', () => {
    expect(isDownstreamEnv(full, null)).toBe(false);
    expect(isDownstreamEnv(chain('dev', 'prod'), 'preprod')).toBe(false);
  });
});

describe('nextEnv', () => {
  it('proposes the next step of a linear chain', () => {
    expect(nextEnv(full, 'dev')).toBe('preprod');
    expect(nextEnv(full, 'preprod')).toBe('prod');
  });

  it('takes the first declared branch when several envs follow', () => {
    const branched = [...full, { ...full[1], id: 'recette-a', label: 'RECETTE A', after: 'dev' }];
    expect(nextEnv(branched, 'dev')).toBe('preprod');
  });

  it('proposes nothing past the end of the chain', () => {
    expect(nextEnv(full, 'prod')).toBeNull();
  });

  it('proposes nothing for an undetermined or undeclared env', () => {
    expect(nextEnv(full, null)).toBeNull();
    expect(nextEnv(full, 'qualif')).toBeNull();
  });
});
