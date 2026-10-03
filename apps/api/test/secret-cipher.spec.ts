import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SecretCipher, secretCipherFromEnv } from '../src/infra/secrets/secret-cipher';

/**
 * Le chiffrement des secrets au repos : ce qui sort de la base n'est lisible
 * qu'avec la clé, une valeur d'avant le chiffrement se relit telle quelle, et
 * une clé fausse se DIT au lieu de rendre du charabia qui partirait vers n8n.
 */

const key = () => randomBytes(32).toString('base64');

describe('SecretCipher', () => {
  it('rend la valeur d’origine, et ne stocke jamais le clair', () => {
    const cipher = new SecretCipher(key());
    const stored = cipher.encrypt('n8n_api_secret');

    expect(stored.startsWith('enc:v1:')).toBe(true);
    expect(stored).not.toContain('n8n_api_secret');
    expect(cipher.decrypt(stored)).toBe('n8n_api_secret');
  });

  it('chiffre deux fois la même valeur différemment (IV aléatoire)', () => {
    const cipher = new SecretCipher(key());
    expect(cipher.encrypt('même')).not.toBe(cipher.encrypt('même'));
  });

  it('relit telle quelle une valeur d’avant le chiffrement', () => {
    expect(new SecretCipher(key()).decrypt('n8n_api_legacy')).toBe('n8n_api_legacy');
  });

  it('ne rechiffre pas une valeur déjà chiffrée', () => {
    const cipher = new SecretCipher(key());
    const stored = cipher.encrypt('x');
    expect(cipher.encrypt(stored)).toBe(stored);
  });

  it('refuse une autre clé, en le disant', () => {
    const stored = new SecretCipher(key()).encrypt('x');
    expect(() => new SecretCipher(key()).decrypt(stored)).toThrow(/SECRETS_KEY/);
  });

  it('refuse une valeur altérée', () => {
    const cipher = new SecretCipher(key());
    const stored = cipher.encrypt('x');
    const tampered = stored.slice(0, -2) + (stored.endsWith('A') ? 'BB' : 'AA');
    expect(() => cipher.decrypt(tampered)).toThrow(/SECRETS_KEY/);
  });

  it('exige une clé de 32 octets', () => {
    expect(() => new SecretCipher('trop-courte')).toThrow(/32 bytes/);
  });
});

describe('secretCipherFromEnv', () => {
  it('sans SECRETS_KEY : pas de chiffreur, les secrets restent lisibles en clair', () => {
    expect(secretCipherFromEnv({})).toBeNull();
    expect(secretCipherFromEnv({ SECRETS_KEY: '  ' })).toBeNull();
  });

  it('avec SECRETS_KEY : un chiffreur', () => {
    expect(secretCipherFromEnv({ SECRETS_KEY: key() })).toBeInstanceOf(SecretCipher);
  });
});
