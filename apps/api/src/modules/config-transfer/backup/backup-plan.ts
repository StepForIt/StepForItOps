/**
 * Plan d'une sauvegarde complète, déduit du SCHÉMA et non d'une liste écrite à
 * la main : une table ajoutée demain part dans la sauvegarde sans que personne
 * n'ait à s'en souvenir — c'est exactement l'oubli qui a coûté l'historique
 * (l'export de configuration ne connaît que ce qu'on lui a appris).
 *
 * Pur : reçoit la description des modèles (la DMMF de Prisma, réduite à ce qui
 * sert ici) et rend l'ordre d'écriture et la façon de coder chaque colonne.
 */

export interface BackupFieldDef {
  name: string;
  kind: string;
  type: string;
  isList: boolean;
  isRequired: boolean;
  isId?: boolean;
  relationName?: string | null;
  relationFromFields?: readonly string[] | null;
}

export interface BackupModelDef {
  name: string;
  dbName: string | null;
  fields: readonly BackupFieldDef[];
  primaryKey: { fields: readonly string[] } | null;
}

export interface BackupColumn {
  name: string;
  type: string;
  isList: boolean;
  isRequired: boolean;
}

export interface BackupTable {
  /** Nom du modèle Prisma : c'est lui qu'on écrit dans le fichier. */
  model: string;
  /** Nom de la table en base (TRUNCATE). */
  table: string;
  /** Clé de pagination de l'export. */
  idFields: string[];
  columns: BackupColumn[];
  /** Modèles dont les lignes doivent exister avant celles-ci. */
  dependsOn: string[];
}

export interface BackupPlan {
  /** Ordre d'écriture : chaque table après celles qu'elle référence. */
  tables: BackupTable[];
  /** Tables de jointure implicites des relations n-n (`_Relation`, colonnes A et B). */
  joins: string[];
}

export function backupPlan(models: readonly BackupModelDef[]): BackupPlan {
  const byName = new Map(models.map((m) => [m.name, m]));
  const tables = models.map((m) => toTable(m));
  const joins = new Set<string>();

  for (const model of models) {
    for (const field of model.fields) {
      if (field.kind !== 'object' || !field.isList || (field.relationFromFields?.length ?? 0) > 0) continue;
      const other = byName.get(field.type);
      const back = other?.fields.find((f) => f.relationName === field.relationName && f !== field);
      if (back?.isList && field.relationName) joins.add(`_${field.relationName}`);
    }
  }

  return { tables: topoSort(tables), joins: [...joins].sort() };
}

function toTable(model: BackupModelDef): BackupTable {
  const columns = model.fields
    .filter((f) => f.kind === 'scalar' || f.kind === 'enum')
    .map((f) => ({ name: f.name, type: f.type, isList: f.isList, isRequired: f.isRequired }));
  const idField = model.fields.find((f) => f.isId);
  const idFields = model.primaryKey?.fields.length
    ? [...model.primaryKey.fields]
    : idField
      ? [idField.name]
      : columns.map((c) => c.name);
  const dependsOn = [
    ...new Set(
      model.fields
        .filter(
          (f) => f.kind === 'object' && (f.relationFromFields?.length ?? 0) > 0 && f.type !== model.name,
        )
        .map((f) => f.type),
    ),
  ];
  return { model: model.name, table: model.dbName ?? model.name, idFields, columns, dependsOn };
}

/** Kahn, stable : à dépendances égales, l'ordre du schéma. Un cycle est une erreur de conception. */
function topoSort(tables: BackupTable[]): BackupTable[] {
  const done = new Set<string>();
  const ordered: BackupTable[] = [];
  let pending = tables;
  while (pending.length > 0) {
    const ready = pending.filter((t) => t.dependsOn.every((d) => done.has(d)));
    if (ready.length === 0) {
      throw new Error(`Circular foreign keys between ${pending.map((t) => t.model).join(', ')}`);
    }
    for (const t of ready) {
      ordered.push(t);
      done.add(t.model);
    }
    pending = pending.filter((t) => !done.has(t.model));
  }
  return ordered;
}

/**
 * L'ordre du FICHIER convient-il à ce schéma ? Oui si chaque table y arrive après
 * celles qu'elle référence. Une sauvegarde prise sur une autre version du schéma
 * peut ne pas le respecter : la restauration relit alors le fichier table par table.
 */
export function fileOrderCompatible(plan: BackupPlan, fileOrder: readonly string[]): boolean {
  const byModel = new Map(plan.tables.map((t) => [t.model, t]));
  const seen = new Set<string>();
  for (const model of fileOrder) {
    const table = byModel.get(model);
    if (table && table.dependsOn.some((d) => fileOrder.includes(d) && !seen.has(d))) return false;
    seen.add(model);
  }
  return true;
}

/**
 * Colonne → JSON. Seuls les types que JSON ne sait pas dire sont retouchés :
 * octets en base64 (une pièce jointe du chat), entiers longs et décimaux en texte.
 * Les dates sortent en ISO d'elles-mêmes.
 */
export function encodeRow(table: BackupTable, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const column of table.columns) {
    const value = row[column.name];
    out[column.name] = value == null ? null : encodeValue(column.type, value);
  }
  return out;
}

function encodeValue(type: string, value: unknown): unknown {
  if (Array.isArray(value) && type !== 'Json') return value.map((v) => encodeValue(type, v));
  if (type === 'Bytes' && value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  if (type === 'BigInt' || type === 'Decimal') return String(value);
  return value;
}

export interface JsonNulls {
  /** NULL SQL, pour une colonne Json facultative. */
  db: unknown;
  /** `null` JSON, pour une colonne Json obligatoire. */
  json: unknown;
}

/**
 * JSON → colonne, pour `createMany`. Rend aussi les colonnes du fichier que ce
 * schéma ne connaît pas : elles sont écartées, et l'aperçu les annonce.
 */
export function decodeRow(
  table: BackupTable,
  row: Record<string, unknown>,
  nulls: JsonNulls,
): { data: Record<string, unknown>; unknown: string[] } {
  const data: Record<string, unknown> = {};
  const known = new Set(table.columns.map((c) => c.name));
  for (const column of table.columns) {
    if (!(column.name in row)) continue; // colonne ajoutée depuis : sa valeur par défaut
    const value = row[column.name];
    if (value === null && column.type === 'Json') {
      data[column.name] = column.isRequired ? nulls.json : nulls.db;
    } else {
      data[column.name] = value === null ? null : decodeValue(column, value);
    }
  }
  return { data, unknown: Object.keys(row).filter((k) => !known.has(k)) };
}

function decodeValue(column: BackupColumn, value: unknown): unknown {
  if (column.isList && Array.isArray(value)) {
    return value.map((v) => decodeValue({ ...column, isList: false }, v));
  }
  switch (column.type) {
    case 'DateTime':
      return typeof value === 'string' ? new Date(value) : value;
    case 'Bytes':
      return typeof value === 'string' ? Buffer.from(value, 'base64') : value;
    case 'BigInt':
      return typeof value === 'string' || typeof value === 'number' ? BigInt(value) : value;
    default:
      return value;
  }
}
