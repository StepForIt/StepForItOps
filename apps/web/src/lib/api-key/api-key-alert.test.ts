import { describe, expect, it } from 'vitest';
import { apiKeyAlert } from './api-key-alert';

const base = { apiKeyExpiresAt: null, apiKeyRejectedAt: null };

describe('apiKeyAlert', () => {
  it('rien pour une clé saine ou sans date', () => {
    expect(apiKeyAlert({ ...base, apiKeyState: 'ok' })).toBeNull();
    expect(apiKeyAlert({ ...base, apiKeyState: 'unknown' })).toBeNull();
  });

  it('orange sous J-14', () => {
    expect(apiKeyAlert({ ...base, apiKeyState: 'soon' })).toEqual({ level: 'warning', reason: 'soon' });
  });

  it('rouge si expirée', () => {
    expect(apiKeyAlert({ ...base, apiKeyState: 'expired' })).toEqual({ level: 'error', reason: 'expired' });
  });

  it('le refus prime sur la date, même pour une clé sans date', () => {
    const rejected = { ...base, apiKeyRejectedAt: '2026-09-28T08:00:00Z' };
    expect(apiKeyAlert({ ...rejected, apiKeyState: 'unknown' })).toEqual({
      level: 'error',
      reason: 'rejected',
    });
    expect(apiKeyAlert({ ...rejected, apiKeyState: 'soon' })).toEqual({ level: 'error', reason: 'rejected' });
  });
});
