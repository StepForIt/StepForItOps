import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Chiffrement des secrets au repos (AES-256-GCM).
 *
 * La clé vit HORS de la base (`SECRETS_KEY`, 32 octets en base64) : une copie de
 * la base seule — sauvegarde Dokploy, dump égaré — ne livre plus les clés API ni
 * les comptes n8n des clients. GCM authentifie en plus du chiffrement : une
 * valeur altérée ou relue avec une autre clé échoue, au lieu de rendre des
 * octets qu'on enverrait à n8n comme une clé.
 *
 * Une valeur sans préfixe est une valeur d'AVANT le chiffrement : elle se relit
 * telle quelle, et le démarrage la chiffre (`SecretsBootstrap`).
 */

const PREFIX = 'enc:v1:';
const IV_BYTES = 12;

export class SecretCipher {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key.trim(), 'base64');
    if (key.length !== 32) {
      throw new Error('SECRETS_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32).');
    }
    this.key = key;
  }

  static isEncrypted(value: string): boolean {
    return value.startsWith(PREFIX);
  }

  encrypt(plain: string): string {
    if (SecretCipher.isEncrypted(plain)) return plain;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return PREFIX + [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url')).join('.');
  }

  decrypt(stored: string): string {
    if (!SecretCipher.isEncrypted(stored)) return stored;
    const [iv, tag, body] = stored
      .slice(PREFIX.length)
      .split('.')
      .map((part) => Buffer.from(part, 'base64url'));
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    } catch {
      throw new Error(
        'A stored secret cannot be decrypted: SECRETS_KEY is not the key it was encrypted with.',
      );
    }
  }
}

/** Sans `SECRETS_KEY`, pas de chiffreur : les secrets restent en clair, et la console le signale. */
export function secretCipherFromEnv(env: Record<string, string | undefined>): SecretCipher | null {
  const key = env.SECRETS_KEY?.trim();
  return key ? new SecretCipher(key) : null;
}

/** Jeton d'injection du chiffreur (null sans `SECRETS_KEY`). */
export const SECRET_CIPHER = Symbol('SECRET_CIPHER');
