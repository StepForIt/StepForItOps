import { describe, expect, it } from 'vitest';
import { BulkExemplar, BulkFamily, planBulkEnvAction } from '../src/domain/bulk-env-plan';

const exemplar = (over: Partial<BulkExemplar>): BulkExemplar => ({
  id: 'w1',
  name: 'Facturation - DEV',
  env: 'dev',
  instanceId: 'i-dev',
  archived: false,
  archivedUpstream: false,
  missing: false,
  ...over,
});

const family = (members: BulkExemplar[]): BulkFamily => ({
  key: 'facturation',
  name: 'Facturation',
  members,
});

describe('planBulkEnvAction — promote', () => {
  it('targets the instance where the target env already lives', () => {
    const [row] = planBulkEnvAction(
      [
        family([
          exemplar({}),
          exemplar({ id: 'w2', name: 'Facturation - PROD', env: 'prod', instanceId: 'i-prod' }),
        ]),
      ],
      { action: 'promote', sourceEnv: 'dev', targetEnv: 'prod', fallbackInstanceId: 'i-other' },
    );
    expect(row).toMatchObject({
      status: 'planned',
      sourceId: 'w1',
      targetInstanceId: 'i-prod',
      targetExemplarId: 'w2',
    });
  });

  it('falls back to the chosen instance when the target env does not exist yet', () => {
    const [row] = planBulkEnvAction([family([exemplar({})])], {
      action: 'promote',
      sourceEnv: 'dev',
      targetEnv: 'prod',
      fallbackInstanceId: 'i-prod',
    });
    expect(row).toMatchObject({ status: 'planned', targetInstanceId: 'i-prod' });
  });

  it('falls back to the source instance when no fallback is given', () => {
    const [row] = planBulkEnvAction([family([exemplar({})])], {
      action: 'promote',
      sourceEnv: 'dev',
      targetEnv: 'prod',
    });
    expect(row).toMatchObject({ status: 'planned', targetInstanceId: 'i-dev' });
  });

  it('skips a family without an exemplar in the source env', () => {
    const [row] = planBulkEnvAction([family([exemplar({ env: 'prod' })])], {
      action: 'promote',
      sourceEnv: 'dev',
      targetEnv: 'prod',
    });
    expect(row.status).toBe('skipped');
    expect(row.status === 'skipped' && row.reason).toMatch(/aucun exemplaire DEV/);
  });

  it('does not take an archived or missing exemplar as source', () => {
    const rows = planBulkEnvAction(
      [
        family([exemplar({ archived: true })]),
        family([exemplar({ archivedUpstream: true })]),
        family([exemplar({ missing: true })]),
      ],
      { action: 'promote', sourceEnv: 'dev', targetEnv: 'prod' },
    );
    expect(rows.map((row) => row.status)).toEqual(['skipped', 'skipped', 'skipped']);
  });

  it('skips when the source env has several exemplars — which one to promote is a human call', () => {
    const [row] = planBulkEnvAction([family([exemplar({}), exemplar({ id: 'w3', instanceId: 'i-other' })])], {
      action: 'promote',
      sourceEnv: 'dev',
      targetEnv: 'prod',
    });
    expect(row.status === 'skipped' && row.reason).toMatch(/plusieurs exemplaires DEV/);
  });

  it('skips when the target env has several exemplars', () => {
    const [row] = planBulkEnvAction(
      [
        family([
          exemplar({}),
          exemplar({ id: 'p1', env: 'prod', instanceId: 'i-a' }),
          exemplar({ id: 'p2', env: 'prod', instanceId: 'i-b' }),
        ]),
      ],
      { action: 'promote', sourceEnv: 'dev', targetEnv: 'prod' },
    );
    expect(row.status === 'skipped' && row.reason).toMatch(/plusieurs exemplaires PROD/);
  });
});

describe('planBulkEnvAction — duplicate', () => {
  it('copies on the source instance', () => {
    const [row] = planBulkEnvAction([family([exemplar({})])], {
      action: 'duplicate',
      sourceEnv: 'dev',
      targetEnv: 'preprod',
      fallbackInstanceId: 'i-prod',
    });
    expect(row).toMatchObject({ status: 'planned', targetInstanceId: 'i-dev' });
  });

  it('skips when a copy already lives in the target env on the same instance', () => {
    const [row] = planBulkEnvAction([family([exemplar({}), exemplar({ id: 'w2', env: 'preprod' })])], {
      action: 'duplicate',
      sourceEnv: 'dev',
      targetEnv: 'preprod',
    });
    expect(row.status === 'skipped' && row.reason).toMatch(/copie PREPROD existe déjà/);
  });

  it('still copies when the target env only lives on another instance', () => {
    const [row] = planBulkEnvAction(
      [family([exemplar({}), exemplar({ id: 'w2', env: 'preprod', instanceId: 'i-other' })])],
      { action: 'duplicate', sourceEnv: 'dev', targetEnv: 'preprod' },
    );
    expect(row.status).toBe('planned');
  });
});

describe('planBulkEnvAction — mark', () => {
  it('declares the only exemplar without env', () => {
    const [row] = planBulkEnvAction([family([exemplar({ env: null, name: 'Facturation' })])], {
      action: 'mark',
      sourceEnv: null,
      targetEnv: 'dev',
    });
    expect(row).toMatchObject({ status: 'planned', sourceId: 'w1', targetInstanceId: 'i-dev' });
  });

  it('skips when several exemplars have no env', () => {
    const [row] = planBulkEnvAction([family([exemplar({ env: null }), exemplar({ id: 'w2', env: null })])], {
      action: 'mark',
      sourceEnv: null,
      targetEnv: 'dev',
    });
    expect(row.status === 'skipped' && row.reason).toMatch(/plusieurs exemplaires sans env/);
  });

  it('skips when the target env already has its exemplar', () => {
    const [row] = planBulkEnvAction([family([exemplar({ env: null, id: 'w0' }), exemplar({ env: 'dev' })])], {
      action: 'mark',
      sourceEnv: null,
      targetEnv: 'dev',
    });
    expect(row.status === 'skipped' && row.reason).toMatch(/a déjà son exemplaire DEV/);
  });
});

describe('planBulkEnvAction — ce qui reste à faire', () => {
  // Une procédure rejouée deux fois doit passer la seconde : « déjà fait » n'est pas un échec.
  it('dit « déjà fait » quand la copie existe, et nomme la copie', () => {
    const [row] = planBulkEnvAction([family([exemplar({}), exemplar({ id: 'w2', env: 'preprod' })])], {
      action: 'duplicate',
      sourceEnv: 'dev',
      targetEnv: 'preprod',
    });
    expect(row).toMatchObject({ status: 'skipped', code: 'already-done', exemplarId: 'w2' });
  });

  it("dit « déjà fait » quand l'env est déjà déclaré et qu'il ne reste rien sans env", () => {
    const [row] = planBulkEnvAction([family([exemplar({ env: 'dev' })])], {
      action: 'mark',
      sourceEnv: null,
      targetEnv: 'dev',
    });
    expect(row).toMatchObject({ status: 'skipped', code: 'already-done', exemplarId: 'w1' });
  });

  it("un exemplaire sans env à côté d'un déjà déclaré est un conflit, pas un « déjà fait »", () => {
    const [row] = planBulkEnvAction([family([exemplar({ env: null, id: 'w0' }), exemplar({ env: 'dev' })])], {
      action: 'mark',
      sourceEnv: null,
      targetEnv: 'dev',
    });
    expect(row).toMatchObject({ status: 'skipped', code: 'conflict' });
  });

  it('distingue ce qui manque de ce qui est à choisir', () => {
    const missing = planBulkEnvAction([family([exemplar({ env: 'prod' })])], {
      action: 'promote',
      sourceEnv: 'dev',
      targetEnv: 'preprod',
    })[0];
    const ambiguous = planBulkEnvAction([family([exemplar({}), exemplar({ id: 'w2' })])], {
      action: 'promote',
      sourceEnv: 'dev',
      targetEnv: 'prod',
    })[0];
    expect(missing).toMatchObject({ code: 'missing' });
    expect(ambiguous).toMatchObject({ code: 'ambiguous' });
  });
});

describe('planBulkEnvAction — request', () => {
  it('refuses the same env as source and target', () => {
    expect(() =>
      planBulkEnvAction([family([exemplar({})])], { action: 'promote', sourceEnv: 'dev', targetEnv: 'dev' }),
    ).toThrow(/identiques/);
  });

  it('keeps the order of the families it was given', () => {
    const rows = planBulkEnvAction(
      [
        { key: 'b', name: 'B', members: [exemplar({ id: 'b1' })] },
        { key: 'a', name: 'A', members: [exemplar({ id: 'a1' })] },
      ],
      { action: 'promote', sourceEnv: 'dev', targetEnv: 'prod' },
    );
    expect(rows.map((row) => row.familyKey)).toEqual(['b', 'a']);
  });
});
