import { describe, expect, it } from 'vitest';
import {
  apiKeyExpiry,
  apiKeyExpiryState,
  apiKeyTier,
  apiKeyTierToAlert,
  isApiKeyRefusal,
} from '../src/domain/api-key-expiry';

const NOW = new Date('2026-09-28T08:00:00Z');
const DAY = 24 * 3600 * 1000;

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature-not-checked`;
}

const inDays = (days: number) => new Date(NOW.getTime() + days * DAY);

describe('apiKeyExpiry', () => {
  it("lit la date d'un JWT qui porte exp", () => {
    const exp = Math.floor(inDays(30).getTime() / 1000);
    const result = apiKeyExpiry(jwt({ sub: 'u1', iss: 'n8n', aud: 'public-api', exp }), NOW);
    expect(result).toEqual({ expiresAt: new Date(exp * 1000), state: 'ok' });
  });

  it('rend unknown pour un JWT sans exp, jamais ok', () => {
    expect(apiKeyExpiry(jwt({ sub: 'u1', iss: 'n8n', aud: 'public-api' }), NOW)).toEqual({
      expiresAt: null,
      state: 'unknown',
    });
  });

  it('rend unknown pour une clé opaque', () => {
    expect(apiKeyExpiry('n8n_api_3f9a0c2b7e1d', NOW).state).toBe('unknown');
    expect(apiKeyExpiry('a.b.c', NOW).state).toBe('unknown');
    expect(apiKeyExpiry('', NOW).state).toBe('unknown');
  });

  it('ignore un exp qui n’est pas un nombre', () => {
    expect(apiKeyExpiry(jwt({ exp: 'demain' }), NOW).state).toBe('unknown');
  });

  it('dit soon sous quatorze jours, expired une fois la date passée', () => {
    const exp = (days: number) => Math.floor(inDays(days).getTime() / 1000);
    expect(apiKeyExpiry(jwt({ exp: exp(10) }), NOW).state).toBe('soon');
    expect(apiKeyExpiry(jwt({ exp: exp(-1) }), NOW).state).toBe('expired');
  });
});

describe('apiKeyExpiryState', () => {
  it('rend unknown sans date', () => {
    expect(apiKeyExpiryState(null, NOW)).toBe('unknown');
  });
});

describe('apiKeyTier', () => {
  it('rien au-delà de quatorze jours', () => {
    expect(apiKeyTier(inDays(14), NOW)).toBe('J-14');
    expect(apiKeyTier(new Date(inDays(14).getTime() + 1), NOW)).toBeNull();
  });

  it('J-14 jusqu’à trois jours exclus, J-3 à trois jours pile', () => {
    expect(apiKeyTier(new Date(inDays(3).getTime() + 1), NOW)).toBe('J-14');
    expect(apiKeyTier(inDays(3), NOW)).toBe('J-3');
    expect(apiKeyTier(new Date(NOW.getTime() + 1), NOW)).toBe('J-3');
  });

  it('expired à la seconde même', () => {
    expect(apiKeyTier(NOW, NOW)).toBe('expired');
    expect(apiKeyTier(inDays(-40), NOW)).toBe('expired');
  });

  it('rien sans date', () => {
    expect(apiKeyTier(null, NOW)).toBeNull();
  });
});

describe('apiKeyTierToAlert', () => {
  it('alerte le premier palier franchi', () => {
    expect(apiKeyTierToAlert('J-14', null)).toBe('J-14');
  });

  it('ne réalerte pas un palier déjà annoncé', () => {
    expect(apiKeyTierToAlert('J-14', 'J-14')).toBeNull();
    expect(apiKeyTierToAlert('expired', 'expired')).toBeNull();
  });

  it('alerte le palier suivant', () => {
    expect(apiKeyTierToAlert('J-3', 'J-14')).toBe('J-3');
    expect(apiKeyTierToAlert('expired', 'J-3')).toBe('expired');
  });

  it("une clé déjà expirée au premier passage n'envoie que expired", () => {
    expect(apiKeyTierToAlert('expired', null)).toBe('expired');
  });

  it('ne redescend jamais', () => {
    expect(apiKeyTierToAlert('J-14', 'J-3')).toBeNull();
    expect(apiKeyTierToAlert(null, 'J-3')).toBeNull();
  });
});

describe('isApiKeyRefusal', () => {
  it('reconnaît un 401 ou un 403, quelle que soit la plateforme', () => {
    expect(isApiKeyRefusal({ status: 401 })).toBe(true);
    expect(isApiKeyRefusal(Object.assign(new Error('Forbidden'), { status: 403 }))).toBe(true);
  });

  it('laisse passer le reste', () => {
    expect(isApiKeyRefusal({ status: 404 })).toBe(false);
    expect(isApiKeyRefusal(new Error('ECONNREFUSED'))).toBe(false);
    expect(isApiKeyRefusal(undefined)).toBe(false);
  });
});
