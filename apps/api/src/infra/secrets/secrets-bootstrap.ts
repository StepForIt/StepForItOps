import { PrismaClient } from '@prisma/client';
import { SecretCipher } from './secret-cipher';

/**
 * Ce que le démarrage règle avant de servir quoi que ce soit, lu en SQL brut
 * (la base telle qu'elle est, sans l'extension qui déchiffre) :
 * - une clé posée sur une base d'avant le chiffrement : les secrets en clair
 *   sont chiffrés, une fois — la passe suivante n'en trouve plus ;
 * - des secrets chiffrés sans clé, ou avec une autre clé : on REFUSE de
 *   démarrer. Servir quand même enverrait du chiffré à n8n comme une clé API,
 *   et chaque instance passerait pour une clé révoquée.
 */

interface Logger {
  log(message: string): void;
  warn(message: string): void;
}

interface StoredSecrets {
  id: string;
  apiKey: string;
  n8nPassword: string | null;
}

export async function prepareInstanceSecrets(
  prisma: PrismaClient,
  cipher: SecretCipher | null,
  logger: Logger,
): Promise<{ encrypted: number }> {
  const rows = await prisma.$queryRaw<StoredSecrets[]>`SELECT id, "apiKey", "n8nPassword" FROM "Instance"`;
  const values = (row: StoredSecrets) => [row.apiKey, row.n8nPassword].filter((v): v is string => !!v);
  const sealed = rows.flatMap(values).filter((v) => SecretCipher.isEncrypted(v));

  if (!cipher) {
    if (sealed.length > 0) {
      throw new Error(
        'Instance secrets are encrypted in the database but SECRETS_KEY is not set: refusing to start. ' +
          'Restore the SECRETS_KEY they were encrypted with.',
      );
    }
    if (rows.length > 0) logger.warn('SECRETS_KEY is not set: instance secrets are stored in clear.');
    return { encrypted: 0 };
  }

  // Une seule valeur suffit à prouver la clé : GCM refuse toute autre clé.
  if (sealed.length > 0) cipher.decrypt(sealed[0]);

  const plain = rows.filter((row) => values(row).some((v) => !SecretCipher.isEncrypted(v)));
  for (const row of plain) {
    const password = row.n8nPassword === null ? null : cipher.encrypt(row.n8nPassword);
    await prisma.$executeRaw`UPDATE "Instance" SET "apiKey" = ${cipher.encrypt(row.apiKey)}, "n8nPassword" = ${password} WHERE id = ${row.id}`;
  }
  if (plain.length > 0) logger.log(`Encrypted the secrets of ${plain.length} instance(s) at rest.`);
  return { encrypted: plain.length };
}
