import { describe, expect, it } from 'vitest';
import { categorizeError } from '../src/domain/error-category';

describe('error-category', () => {
  it('classe les problèmes d’authentification', () => {
    expect(categorizeError('401 - Unauthorized')).toBe('auth');
    expect(categorizeError('Authorization failed - please check your credentials')).toBe('auth');
    expect(categorizeError('Invalid API key provided')).toBe('auth');
    expect(categorizeError('Forbidden - perhaps check your credentials?')).toBe('auth');
  });

  it('classe les rate limits avant l’authentification (429 ≠ 401)', () => {
    expect(categorizeError('429 - Too Many Requests')).toBe('rate-limit');
    expect(categorizeError('Rate limit exceeded, retry after 30s')).toBe('rate-limit');
    expect(categorizeError('You exceeded your current quota')).toBe('rate-limit');
    // « API key » ET « rate limit » dans le même message : c'est le rate limit qui agit.
    expect(categorizeError('Rate limit reached for this api key')).toBe('rate-limit');
  });

  it('classe les timeouts avant le réseau', () => {
    expect(categorizeError('connect ETIMEDOUT 10.0.0.1:443')).toBe('timeout');
    expect(categorizeError('The connection timed out')).toBe('timeout');
    expect(categorizeError('Request timeout of 30000ms exceeded')).toBe('timeout');
  });

  it('classe les problèmes réseau', () => {
    expect(categorizeError('connect ECONNREFUSED 127.0.0.1:5678')).toBe('network');
    expect(categorizeError('getaddrinfo ENOTFOUND api.example.com')).toBe('network');
    expect(categorizeError('502 Bad Gateway')).toBe('network');
    expect(categorizeError('socket hang up')).toBe('network');
  });

  it('classe les problèmes de données', () => {
    expect(categorizeError("Cannot read properties of undefined (reading 'id')")).toBe('data');
    expect(categorizeError('Unexpected token < in JSON at position 0')).toBe('data');
    expect(categorizeError('The resource you are requesting could not be found')).toBe('data');
    expect(categorizeError('Unique constraint failed on the fields: (`email`)')).toBe('data');
  });

  it('tombe sur other faute d’indice — jamais de fausse assurance', () => {
    expect(categorizeError('Workflow execution failed')).toBe('other');
    expect(categorizeError(null)).toBe('other');
    expect(categorizeError(undefined)).toBe('other');
    expect(categorizeError('')).toBe('other');
  });
});

describe('le vocabulaire de Make', () => {
  it('range ConnectionError et l anglais courant dans réseau', () => {
    expect(categorizeError('ConnectionError')).toBe('network');
    expect(categorizeError('Connection refused by crm.example')).toBe('network');
    expect(categorizeError('Cannot connect to the third-party service')).toBe('network');
  });

  it('range DataError dans données', () => {
    expect(categorizeError('DataError: missing required field')).toBe('data');
  });

  it('reconnaît RateLimitError et les timeouts de module sans règle nouvelle', () => {
    expect(categorizeError('RateLimitError')).toBe('rate-limit');
    expect(categorizeError('ModuleTimeoutError')).toBe('timeout');
  });

  it('laisse en `other` ce dont le genre ne se déduit pas : mieux vaut « à regarder » qu’un faux tri', () => {
    expect(categorizeError('RuntimeError')).toBe('other');
    expect(categorizeError('InvalidConfigurationError')).toBe('other');
    expect(categorizeError('MaxFileSizeExceededError')).toBe('other');
  });
});
