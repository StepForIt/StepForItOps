import { PrismaClient } from '@prisma/client';
import { SecretCipher } from './secret-cipher';

/**
 * Chiffrement TRANSPARENT des secrets d'instance, posé une fois sur le client
 * Prisma : une dizaine de services lisent `Instance.apiKey` (surveillance,
 * performance, coûts IA, catalogue, export, sauvegarde), parfois à travers un
 * `include` d'un workflow. Les chiffrer site par site laisserait toujours un
 * lecteur oublié envoyer du chiffré à n8n comme une clé.
 *
 * Écriture : chiffré quelle que soit la forme (`create`, `update` avec ou sans
 * `set`, `upsert`, `createMany`). Lecture : déchiffré partout, imbriqué compris.
 * Le SQL brut, lui, voit ce que la base contient vraiment.
 */

const INSTANCE_SECRETS = ['apiKey', 'n8nPassword'] as const;

type Data = Record<string, unknown>;

function encryptValue(value: unknown, cipher: SecretCipher): unknown {
  if (typeof value === 'string') return cipher.encrypt(value);
  if (value && typeof value === 'object' && typeof (value as Data).set === 'string') {
    return { ...(value as Data), set: cipher.encrypt((value as { set: string }).set) };
  }
  return value;
}

function encryptData(data: unknown, cipher: SecretCipher): unknown {
  if (Array.isArray(data)) return data.map((row) => encryptData(row, cipher));
  if (!data || typeof data !== 'object') return data;
  const copy: Data = { ...(data as Data) };
  for (const field of INSTANCE_SECRETS) {
    if (field in copy) copy[field] = encryptValue(copy[field], cipher);
  }
  return copy;
}

export function withSecretEncryption<T extends PrismaClient>(client: T, cipher: SecretCipher | null): T {
  if (!cipher) return client;
  return client.$extends({
    query: {
      instance: {
        async $allOperations({ args, query }) {
          const writable = args as Data;
          for (const key of ['data', 'create', 'update'] as const) {
            if (key in writable) writable[key] = encryptData(writable[key], cipher);
          }
          return query(args);
        },
      },
    },
    result: {
      instance: {
        apiKey: { needs: { apiKey: true }, compute: (row) => cipher.decrypt(row.apiKey) },
        n8nPassword: {
          needs: { n8nPassword: true },
          compute: (row) => (row.n8nPassword === null ? null : cipher.decrypt(row.n8nPassword)),
        },
      },
    },
  }) as unknown as T;
}
