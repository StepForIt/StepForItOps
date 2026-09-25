/**
 * Ce que l'écran et la promotion montrent d'un contrôle des tables distantes :
 * par table, son état et chaque colonne attendue, présente ou non. Une table
 * qu'on n'a pas pu lire reste `unverified` avec sa raison — jamais `ok`.
 */

import { CheckFinding } from '../check-finding';
import { closestField } from './field-check';
import { RemoteRequirements, RequiredColumn, UnlocatableNode } from './remote-requirements';
import { RemoteTableSchema, compareRemoteSchema } from './remote-schema-compare';

export type TableReadOutcome =
  { status: 'read'; schema: RemoteTableSchema } | { status: 'unverified'; reason: string };

export interface RemoteColumnReport extends RequiredColumn {
  /** `null` : table non lue, on ne sait pas. */
  present: boolean | null;
  suggestion?: string;
}

export interface RemoteTableReport {
  key: string;
  provider: string;
  label?: string;
  nodes: string[];
  /** `issues` : au moins une colonne absente ; `missing` : table introuvable. */
  status: 'ok' | 'issues' | 'missing' | 'unverified';
  reason?: string;
  columns: RemoteColumnReport[];
  partial: Array<{ nodeName: string; reason: string }>;
}

export interface RemoteSchemaReport {
  tables: RemoteTableReport[];
  unlocatable: UnlocatableNode[];
  findings: CheckFinding[];
}

export function buildRemoteSchemaReport(
  requirements: RemoteRequirements,
  outcomes: Map<string, TableReadOutcome>,
): RemoteSchemaReport {
  const findings: CheckFinding[] = [];
  const tables = requirements.tables.map((requirement): RemoteTableReport => {
    const { locator } = requirement;
    const base = {
      key: locator.key,
      provider: locator.provider,
      label: locator.label,
      nodes: requirement.nodes,
      partial: requirement.partial,
    };
    const outcome = outcomes.get(locator.key) ?? { status: 'unverified', reason: 'table non lue' };
    if (outcome.status === 'unverified') {
      return {
        ...base,
        status: 'unverified',
        reason: outcome.reason,
        columns: requirement.columns.map((column) => ({ ...column, present: null })),
      };
    }

    findings.push(...compareRemoteSchema(requirement, outcome.schema));
    const { schema } = outcome;
    if (!schema.found) {
      return {
        ...base,
        status: 'missing',
        columns: requirement.columns.map((column) => ({ ...column, present: null })),
      };
    }
    const names = schema.columns.flatMap((column) =>
      column.alias ? [column.name, column.alias] : [column.name],
    );
    const columns = requirement.columns.map((column): RemoteColumnReport => {
      const present = names.includes(column.name);
      const suggestion = present ? undefined : closestField(column.name, names);
      return { ...column, present, ...(suggestion ? { suggestion } : {}) };
    });
    return { ...base, status: columns.every((column) => column.present) ? 'ok' : 'issues', columns };
  });
  return { tables, unlocatable: requirements.unlocatable, findings };
}
