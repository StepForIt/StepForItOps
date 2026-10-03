import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Clé d'export : une phrase donnée à l'export, redemandée à l'import. Elle
 * scelle les secrets d'un fichier exporté (export de configuration, sauvegarde
 * complète) — et ce fichier seul : elle n'emporte jamais `SECRETS_KEY`, la clé
 * de la base, si bien que perdre un fichier et sa phrase n'ouvre ni la base, ni
 * ses sauvegardes Dokploy, ni les secrets ajoutés après coup.
 *
 * La phrase passe par scrypt (sel aléatoire par fichier) : une phrase humaine
 * n'a pas l'entropie d'une clé, il faut qu'essayer chaque candidat coûte.
 */

export const MIN_EXPORT_KEY_LENGTH = 12;
const PREFIX = 'xenc:v1:';
const CHECK = 'nwm-export-key';
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export type ExportKeyFailure = 'missing' | 'too-short' | 'wrong';

/** Une phrase absente, trop courte ou fausse — à traduire en 400 par qui reçoit la requête. */
export class ExportKeyError extends Error {
  constructor(readonly reason: ExportKeyFailure) {
    super(`Export key ${reason}`);
  }
}

/** Ce que le fichier porte pour qu'on rouvre ses secrets : le sel, et une valeur témoin. */
export interface SealingHeader {
  kdf: 'scrypt';
  salt: string;
  check: string;
}

export function deriveExportKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, SCRYPT);
}

export class ExportKey {
  private constructor(
    private readonly key: Buffer,
    private readonly salt: Buffer,
  ) {}

  /** À l'export : une phrase suffisamment longue, un sel neuf. */
  static create(passphrase: string | undefined): ExportKey {
    ExportKey.assertUsable(passphrase);
    const salt = randomBytes(16);
    return new ExportKey(deriveExportKey(passphrase, salt), salt);
  }

  /** Vérifie la phrase sans dériver de clé (scrypt coûte, à dessein). */
  static assertUsable(passphrase: string | undefined): asserts passphrase is string {
    if (!passphrase) throw new ExportKeyError('missing');
    if (passphrase.length < MIN_EXPORT_KEY_LENGTH) throw new ExportKeyError('too-short');
  }

  /** À l'import : la phrase redonnée est vérifiée sur la valeur témoin, avant tout secret. */
  static open(header: SealingHeader, passphrase: string | undefined): ExportKey {
    if (!passphrase) throw new ExportKeyError('missing');
    const salt = Buffer.from(header.salt, 'base64');
    const key = new ExportKey(deriveExportKey(passphrase, salt), salt);
    if (key.unseal(header.check) !== CHECK) throw new ExportKeyError('wrong');
    return key;
  }

  static isSealed(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith(PREFIX);
  }

  header(): SealingHeader {
    return { kdf: 'scrypt', salt: this.salt.toString('base64'), check: this.seal(CHECK) };
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return PREFIX + [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url')).join('.');
  }

  unseal(value: string): string {
    if (!ExportKey.isSealed(value)) return value;
    const [iv, tag, body] = value
      .slice(PREFIX.length)
      .split('.')
      .map((part) => Buffer.from(part, 'base64url'));
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    } catch {
      throw new ExportKeyError('wrong');
    }
  }
}
