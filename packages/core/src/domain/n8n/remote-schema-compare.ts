/**
 * Confrontation des colonnes attendues (`remote-requirements.ts`) au schéma
 * RÉEL de la table distante. Une colonne absente est une écriture qui échouera
 * — Airtable « Unknown field name », NocoDB et Postgres refusent la ligne — ou
 * une lecture qui remontera vide, sans que rien ne le dise à l'éditeur n8n.
 */

import { CheckFinding } from '../check-finding';
import { closestField } from './field-check';
import { RemoteTableRequirement } from './remote-requirements';

export interface RemoteColumn {
  name: string;
  /** Nom technique quand le provider en distingue un (NocoDB `column_name`). */
  alias?: string;
  type?: string;
}

/** Ce qu'on a lu de la table : elle existe avec ces colonnes, ou elle est introuvable. */
export type RemoteTableSchema = { found: true; columns: RemoteColumn[] } | { found: false };

export type RemoteSchemaCode = 'remote-table-missing' | 'remote-column-missing';

export const REMOTE_SCHEMA_CODES: readonly RemoteSchemaCode[] = [
  'remote-table-missing',
  'remote-column-missing',
];

function tableName(requirement: RemoteTableRequirement): string {
  return requirement.locator.label ?? requirement.locator.key;
}

/** Findings d'une table : un par nœud pour une table absente, un par (nœud, colonne) sinon. */
export function compareRemoteSchema(
  requirement: RemoteTableRequirement,
  schema: RemoteTableSchema,
): CheckFinding[] {
  const table = tableName(requirement);
  if (!schema.found) {
    return requirement.nodes.map((nodeName) => ({
      severity: 'error',
      code: 'remote-table-missing',
      message: `La table « ${table} » est introuvable sur ${requirement.locator.provider}`,
      nodeName,
      data: { resourceKey: requirement.locator.key, provider: requirement.locator.provider },
    }));
  }

  const names = schema.columns.flatMap((column) =>
    column.alias ? [column.name, column.alias] : [column.name],
  );
  const present = new Set(names);
  return requirement.columns
    .filter((column) => !present.has(column.name))
    .map((column) => {
      const suggestion = closestField(column.name, names);
      const origin = column.via ? ` (clé posée par le Set « ${column.via} »)` : '';
      const verb = column.access === 'write' ? 'écrit' : 'lit';
      return {
        severity: column.severity,
        code: 'remote-column-missing',
        message:
          `La colonne « ${column.name} » que ce nœud ${verb}${origin} n'existe pas dans « ${table} »` +
          (column.severity === 'warning' ? ' : la donnée sera ignorée' : ''),
        nodeName: column.nodeName,
        data: {
          resourceKey: requirement.locator.key,
          provider: requirement.locator.provider,
          column: column.name,
          access: column.access,
          ...(column.via ? { via: column.via } : {}),
          ...(suggestion ? { suggestion: `Colonne proche : « ${suggestion} »` } : {}),
        },
      } satisfies CheckFinding;
    });
}
