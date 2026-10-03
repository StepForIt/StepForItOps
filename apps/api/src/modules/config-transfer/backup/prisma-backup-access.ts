import { Prisma } from '@prisma/client';
import { BackupModelDef, BackupPlan, backupPlan } from './backup-plan';

/**
 * Le seul endroit qui parle à Prisma sans passer par ses types générés : une
 * sauvegarde générique parcourt TOUS les modèles, et soixante délégués typés un
 * par un seraient justement la liste écrite à la main qu'on veut éviter.
 */

/** Ce que la sauvegarde demande à un délégué Prisma (`prisma.workflow`, …). */
export interface BackupDelegate {
  count(): Promise<number>;
  findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  createMany(args: { data: Record<string, unknown>[] }): Promise<{ count: number }>;
}

/** Client ou transaction : les deux exposent délégués et SQL brut. */
export interface BackupClient {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

let plan: BackupPlan | null = null;

export function schemaBackupPlan(): BackupPlan {
  plan ??= backupPlan(Prisma.dmmf.datamodel.models as unknown as readonly BackupModelDef[]);
  return plan;
}

export function delegateOf(client: BackupClient, model: string): BackupDelegate {
  const key = model.charAt(0).toLowerCase() + model.slice(1);
  return (client as unknown as Record<string, BackupDelegate>)[key];
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Dernière migration appliquée — information, jamais un refus : une base en `db push` n'en a pas. */
export async function currentSchemaId(client: BackupClient): Promise<string | null> {
  try {
    const rows = await client.$queryRawUnsafe<{ migration_name: string }[]>(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1',
    );
    return rows[0]?.migration_name ?? null;
  } catch {
    return null;
  }
}

export const JSON_NULLS = { db: Prisma.DbNull, json: Prisma.JsonNull };
