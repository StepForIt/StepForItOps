import { describe, expect, it } from 'vitest';
import { assessImpact, ImpactFacts, impactLevelOf, summarizeImpacts } from '../src/domain/impact-study';
import { procedureImpactTargets, ProcedureTargetStep } from '../src/domain/procedure-impact-targets';

const quiet: ImpactFacts = {
  active: false,
  monitoredEnv: false,
  callers: 0,
  executions30d: 0,
  failures30d: 0,
  publicEntryPoints: 0,
  monitors: 0,
  openErrors: 0,
  unmappedResources: 0,
  testCases: 0,
  redTests: 0,
  locked: false,
};

describe('assessImpact', () => {
  it('un workflow inactif sans appelant est faible, et le dit', () => {
    const result = assessImpact(quiet);
    expect(result.level).toBe('low');
    expect(result.reasons).toHaveLength(1);
  });

  it('un workflow de prod actif, très appelé et très exécuté est critique, chaque point nommé', () => {
    const result = assessImpact({
      ...quiet,
      active: true,
      monitoredEnv: true,
      callers: 4,
      executions30d: 300,
    });
    expect(result.level).toBe('critical');
    expect(result.reasons).toHaveLength(3);
  });

  it('les garde-fous rassurent sans abaisser le niveau', () => {
    const bare = assessImpact({ ...quiet, active: true, monitoredEnv: true, callers: 1 });
    const guarded = assessImpact({
      ...quiet,
      active: true,
      monitoredEnv: true,
      callers: 1,
      testCases: 3,
      monitors: 1,
      locked: true,
    });
    expect(guarded.level).toBe(bare.level);
    expect(guarded.safeguards).toHaveLength(3);
  });

  it('des tests rouges comptent contre, pas pour', () => {
    const result = assessImpact({ ...quiet, testCases: 2, redTests: 1 });
    expect(result.safeguards).toHaveLength(0);
    expect(result.score).toBe(1);
  });

  it('les paliers', () => {
    expect([0, 2, 4, 7].map(impactLevelOf)).toEqual(['low', 'medium', 'high', 'critical']);
  });
});

describe('summarizeImpacts', () => {
  it('ne compte comme appelants externes que ceux hors du lot', () => {
    const summary = summarizeImpacts([
      { id: 'a', level: 'high', executions30d: 10, callerIds: ['b', 'x'], resourceKeys: ['airtable:1'] },
      {
        id: 'b',
        level: 'low',
        executions30d: 5,
        callerIds: ['x', 'y'],
        resourceKeys: ['airtable:1', 'http:h'],
      },
    ]);
    expect(summary).toMatchObject({
      count: 2,
      highest: 'high',
      executions30d: 15,
      externalCallers: 2,
      resources: 2,
    });
  });
});

describe('procedureImpactTargets', () => {
  const step = (s: Partial<ProcedureTargetStep>): ProcedureTargetStep => ({
    id: 's1',
    kind: 'auto',
    action: 'promote',
    familyKey: 'facturation',
    familyName: 'Facturation',
    sourceEnv: 'dev',
    targetEnv: 'preprod',
    ...s,
  });

  it('décale les envs comme le rejeu : la cible écrite et la source lue', () => {
    const targets = procedureImpactTargets(
      [step({})],
      { source: 'dev', target: 'preprod' },
      { source: 'preprod', target: 'prod' },
    );
    expect(targets.map((t) => [t.env, t.role])).toEqual([
      ['preprod', 'read'],
      ['prod', 'write'],
    ]);
  });

  it('garde le rôle le plus engageant quand deux étapes touchent le même exemplaire', () => {
    const targets = procedureImpactTargets(
      [step({ id: 's1' }), step({ id: 's2', action: 'run-tests', sourceEnv: 'preprod', targetEnv: null })],
      null,
      null,
    );
    const preprod = targets.find((t) => t.env === 'preprod');
    expect(preprod).toMatchObject({ role: 'write', stepIds: ['s1', 's2'] });
  });

  it('ignore les étapes manuelles', () => {
    expect(
      procedureImpactTargets([step({ kind: 'manual', action: null, familyKey: null })], null, null),
    ).toEqual([]);
  });

  it('une déclaration sur l’env de départ ne glisse pas', () => {
    const targets = procedureImpactTargets(
      [step({ action: 'mark', sourceEnv: 'dev', targetEnv: 'dev' })],
      { source: 'dev', target: 'preprod' },
      { source: 'preprod', target: 'prod' },
    );
    // `mark` écrit l'exemplaire de départ, décalé : celui de preprod.
    expect(targets.map((t) => t.env)).toEqual(['preprod']);
  });
});
