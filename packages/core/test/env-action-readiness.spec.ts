import { describe, expect, it } from 'vitest';
import {
  PromotionReadinessInput,
  duplicationReadiness,
  promotionReadiness,
} from '../src/domain/env-action-readiness';

const clean: PromotionReadinessInput = {
  mode: 'create',
  targetActive: false,
  diffHasChanges: false,
  blockers: [],
  forceable: true,
  needsSkipConfirm: false,
  chain: { ok: true, mode: 'warn', through: true },
};

const codes = (input: Partial<PromotionReadinessInput>) =>
  promotionReadiness({ ...clean, ...input }).decisions.map((decision) => decision.code);

describe('promotionReadiness', () => {
  it('is ready when nothing is overwritten and every gate is green', () => {
    expect(promotionReadiness(clean)).toEqual({ status: 'ready', decisions: [], reasons: [] });
  });

  it('asks to read the diff when an existing target changes', () => {
    expect(promotionReadiness({ ...clean, mode: 'update', diffHasChanges: true }).status).toBe('decide');
    expect(codes({ mode: 'update', diffHasChanges: true })).toEqual(['diff']);
  });

  it('is ready when the target exists but nothing changes', () => {
    expect(promotionReadiness({ ...clean, mode: 'update', diffHasChanges: false }).status).toBe('ready');
  });

  it('asks to force the lock when the overwritten target is locked', () => {
    const readiness = promotionReadiness({ ...clean, mode: 'update', targetLocked: true });
    expect(readiness.status).toBe('decide');
    expect(readiness.decisions.map((decision) => decision.code)).toEqual(['locked']);
  });

  it('ignores a lock on a target that the promotion only creates', () => {
    expect(promotionReadiness({ ...clean, mode: 'create', targetLocked: true }).status).toBe('ready');
  });

  it('flags an active target, which means touching a running workflow', () => {
    expect(codes({ mode: 'update', targetActive: true })).toEqual(['target-active']);
  });

  it('asks for force when a gate is red but can be overridden', () => {
    const readiness = promotionReadiness({ ...clean, blockers: ['2 finding(s) de sévérité error'] });
    expect(readiness.status).toBe('decide');
    expect(readiness.decisions).toEqual([
      { code: 'force', label: expect.any(String), details: ['2 finding(s) de sévérité error'] },
    ]);
  });

  it('asks for an explicit skip confirmation, distinct from force', () => {
    expect(codes({ needsSkipConfirm: true })).toEqual(['confirm-skip']);
  });

  it('is blocked when a blocker cannot be forced (archived target)', () => {
    const readiness = promotionReadiness({ ...clean, blockers: ['cible ARCHIVÉE'], forceable: false });
    expect(readiness.status).toBe('blocked');
    expect(readiness.reasons).toEqual(['cible ARCHIVÉE']);
  });

  it('is blocked when the chain is in block mode and a step is skipped', () => {
    const readiness = promotionReadiness({ ...clean, chain: { ok: false, mode: 'block', through: false } });
    expect(readiness.status).toBe('blocked');
  });

  it('lists every decision, in a stable order', () => {
    expect(
      codes({
        mode: 'update',
        diffHasChanges: true,
        targetActive: true,
        blockers: ['1 test(s) en échec'],
        needsSkipConfirm: true,
      }),
    ).toEqual(['diff', 'target-active', 'force', 'confirm-skip']);
  });
});

describe('duplicationReadiness', () => {
  it('is ready when every resource is mapped', () => {
    expect(duplicationReadiness({ alreadyExists: false, sameAsSource: false, unmapped: [] }).status).toBe(
      'ready',
    );
  });

  it('asks to acknowledge resources that stay on the source data', () => {
    const readiness = duplicationReadiness({
      alreadyExists: false,
      sameAsSource: false,
      unmapped: [{ label: 'CRM' }, { label: undefined, key: 'airtable:app1' }],
    });
    expect(readiness.status).toBe('decide');
    expect(readiness.decisions[0]).toMatchObject({ code: 'unmapped', details: ['CRM', 'airtable:app1'] });
  });

  it('is blocked when the copy already exists', () => {
    expect(duplicationReadiness({ alreadyExists: true, sameAsSource: false, unmapped: [] }).status).toBe(
      'blocked',
    );
  });

  it('is blocked when the source is already in the target env', () => {
    expect(duplicationReadiness({ alreadyExists: false, sameAsSource: true, unmapped: [] }).status).toBe(
      'blocked',
    );
  });
});
