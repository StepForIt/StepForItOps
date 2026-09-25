import { describe, expect, it } from 'vitest';
import {
  LockedWorkflow,
  encodeLockOverride,
  lockReasonError,
  lockRefusalMessage,
  lockVerdict,
  parseLockOverride,
} from '../src/domain/workflow-lock';

const prod: LockedWorkflow = { id: 'wf-prod', name: 'Facturation - PROD' };
const other: LockedWorkflow = { id: 'wf-other', name: 'Relances - PROD' };

describe('lockReasonError', () => {
  it('refuses an empty or blank reason', () => {
    expect(lockReasonError('')).not.toBeNull();
    expect(lockReasonError('   ')).not.toBeNull();
  });

  it('refuses a reason too short to mean anything', () => {
    expect(lockReasonError('ok')).not.toBeNull();
  });

  it('accepts a real sentence', () => {
    expect(lockReasonError('correctif urgent du ticket 412')).toBeNull();
  });

  it('refuses a novel', () => {
    expect(lockReasonError('x'.repeat(501))).not.toBeNull();
  });
});

describe('parseLockOverride', () => {
  it('reads ids and an encoded reason, accents included', () => {
    const headers = encodeLockOverride(['wf-prod', 'wf-other'], 'hotfix validé par Léa');
    expect(parseLockOverride(headers.ids, headers.reason)).toEqual({
      workflowIds: ['wf-prod', 'wf-other'],
      reason: 'hotfix validé par Léa',
    });
  });

  it('dedupes and trims ids', () => {
    expect(parseLockOverride(' a , a,, b ', 'raison valable')?.workflowIds).toEqual(['a', 'b']);
  });

  it('is null without ids or without a valid reason', () => {
    expect(parseLockOverride(undefined, 'raison valable')).toBeNull();
    expect(parseLockOverride('a', undefined)).toBeNull();
    expect(parseLockOverride('a', 'ok')).toBeNull();
  });

  it('keeps a reason that is not URI-encoded rather than failing', () => {
    expect(parseLockOverride('a', '100% nécessaire')?.reason).toBe('100% nécessaire');
  });
});

describe('lockVerdict', () => {
  it('lets everything through when nothing is locked', () => {
    expect(lockVerdict([], null)).toEqual({ blocking: [], overridden: [] });
  });

  it('blocks a locked workflow without override', () => {
    expect(lockVerdict([prod], null)).toEqual({ blocking: [prod], overridden: [] });
  });

  it('lets a locked workflow through when the override names it', () => {
    const override = { workflowIds: ['wf-prod'], reason: 'hotfix du jour' };
    expect(lockVerdict([prod], override)).toEqual({ blocking: [], overridden: [prod] });
  });

  it('never extends an override to a workflow it does not name', () => {
    const override = { workflowIds: ['wf-prod'], reason: 'hotfix du jour' };
    expect(lockVerdict([prod, other], override)).toEqual({ blocking: [other], overridden: [prod] });
  });
});

describe('lockRefusalMessage', () => {
  it('names the locked workflow', () => {
    expect(lockRefusalMessage([prod])).toContain('Facturation - PROD');
  });

  it('names every locked workflow', () => {
    const message = lockRefusalMessage([prod, other]);
    expect(message).toContain('Facturation - PROD');
    expect(message).toContain('Relances - PROD');
  });
});
