import { describe, expect, it } from 'vitest';
import { lockReasonError, lockedFromRefusal, overrideHeaders } from './lock-override';

describe('lockedFromRefusal', () => {
  it('lit les exemplaires verrouillés d’un 423 de l’API', () => {
    const body = JSON.stringify({
      statusCode: 423,
      code: 'workflow-locked',
      message: '« Facturation - PROD » est verrouillé',
      locked: [{ id: 'wf1', name: 'Facturation - PROD', lockedBy: 'paul@example.com' }],
    });
    expect(lockedFromRefusal(423, body)).toEqual([
      { id: 'wf1', name: 'Facturation - PROD', lockedBy: 'paul@example.com' },
    ]);
  });

  it('ignore tout autre refus, même en 423', () => {
    expect(lockedFromRefusal(400, JSON.stringify({ code: 'workflow-locked', locked: [] }))).toBeNull();
    expect(lockedFromRefusal(423, JSON.stringify({ message: 'autre chose' }))).toBeNull();
    expect(lockedFromRefusal(423, '<html>')).toBeNull();
  });
});

describe('overrideHeaders', () => {
  it('nomme les workflows levés et encode la raison, accents compris', () => {
    expect(overrideHeaders(['a', 'b'], ' validé par Léa ')).toEqual({
      'x-lock-override': 'a,b',
      'x-lock-override-reason': encodeURIComponent('validé par Léa'),
    });
  });
});

describe('lockReasonError', () => {
  it('exige une vraie raison', () => {
    expect(lockReasonError('')).not.toBeNull();
    expect(lockReasonError('ok')).not.toBeNull();
    expect(lockReasonError('hotfix du ticket 412')).toBeNull();
  });
});
