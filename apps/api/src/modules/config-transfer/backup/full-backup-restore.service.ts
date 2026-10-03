import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { msg } from '@nwm/core';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { isSealedFile, unsealFile } from '../../../infra/secrets/export-file-cipher';
import { exportKeyHttpError } from '../export-key-errors';
import { ModuleRegistryService } from '../../../infra/modules-registry/module-registry.service';
import { PlatformSettingsService } from '../../../infra/settings/platform-settings.service';
import {
  BACKUP_KIND,
  BACKUP_VERSION,
  BackupHeader,
  BackupRowLine,
  RestorePreview,
  RestoreResult,
} from './backup-format';
import { BackupTable, decodeRow, fileOrderCompatible } from './backup-plan';
import {
  BackupClient,
  JSON_NULLS,
  currentSchemaId,
  delegateOf,
  quoteIdent,
  schemaBackupPlan,
} from './prisma-backup-access';

const STAGING_DIR = join(tmpdir(), 'nwm-restore');
/** Un fichier téléversé puis jamais appliqué ne reste pas sur le disque. */
const STAGING_TTL_MS = 60 * 60 * 1000;
const BATCH_ROWS = 500;
/** Une ligne de `Workflow` peut peser plusieurs centaines de ko : on borne aussi le poids d'un lot. */
const BATCH_BYTES = 4 * 1024 * 1024;
/** Tout ou rien, même pour une grosse base : une restauration à moitié écrite serait pire qu'aucune. */
const TRANSACTION_TIMEOUT_MS = 60 * 60 * 1000;

type ParsedLine = { header: BackupHeader } | { row: BackupRowLine } | { end: number };

/**
 * Restauration d'une sauvegarde complète, en deux temps : le fichier est
 * téléversé et relu en entier (aperçu : ce qu'il contient, ce qu'il va
 * remplacer, et s'il est entier), puis appliqué sur confirmation.
 *
 * C'est un REMPLACEMENT, pas une fusion : toutes les tables sont vidées puis
 * remplies avec les lignes du fichier, ids compris, dans une seule transaction.
 * Fusionner des lignes identifiées par des uuids d'une autre base n'aurait pas
 * de sens — c'est le rôle de l'import de configuration.
 */
@Injectable()
export class FullBackupRestoreService {
  private readonly logger = new Logger(FullBackupRestoreService.name);
  private readonly staged = new Map<string, string>();
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ModuleRegistryService,
    private readonly settings: PlatformSettingsService,
  ) {}

  /**
   * Range le fichier sur le disque, le relit, et rend l'aperçu. Un fichier refusé est effacé.
   * Un fichier scellé est descellé par la clé d'export AVANT tout ; une sauvegarde
   * d'avant la clé d'export (gzip nu) passe sans clé.
   */
  async stage(body: Readable, exportKey?: string): Promise<RestorePreview> {
    await mkdir(STAGING_DIR, { recursive: true });
    await this.purgeStale();
    const uploadId = randomUUID();
    const path = join(STAGING_DIR, `${uploadId}.ndjson.gz`);
    await this.receive(body, path, exportKey);
    try {
      const preview = await this.preview(uploadId, path);
      this.staged.set(uploadId, path);
      return preview;
    } catch (error) {
      await unlink(path).catch(() => undefined);
      throw error;
    }
  }

  private async receive(body: Readable, path: string, exportKey: string | undefined): Promise<void> {
    const upload = `${path}.upload`;
    try {
      await pipeline(body, createWriteStream(upload));
      if (await isSealedFile(upload)) await unsealFile(upload, exportKey, path);
      else await rename(upload, path);
    } catch (error) {
      throw exportKeyHttpError(error, 'import');
    } finally {
      await unlink(upload).catch(() => undefined);
    }
  }

  async apply(uploadId: string, confirm: boolean): Promise<RestoreResult> {
    if (!confirm) throw new BadRequestException(msg('platform.backupConfirmRequired'));
    const path = this.staged.get(uploadId);
    if (!path) throw new NotFoundException(msg('platform.backupUnknownUpload'));
    if (this.running) throw new ConflictException(msg('platform.backupBusy'));
    this.running = true;
    const started = Date.now();
    try {
      // Relu une seconde fois : l'aperçu a pu être fait sur un autre schéma (redéploiement entre-temps).
      const { fileOrder, warnings } = await this.scan(path);
      const counts = new Map<string, number>();
      await this.prisma.$transaction(
        async (tx) => {
          const client = tx as unknown as BackupClient;
          await this.truncateAll(client);
          if (fileOrderCompatible(schemaBackupPlan(), fileOrder)) {
            await this.insertPass(client, path, null, counts);
          } else {
            for (const model of this.localOrder(fileOrder)) {
              await this.insertPass(client, path, model, counts);
            }
          }
        },
        { timeout: TRANSACTION_TIMEOUT_MS, maxWait: 10_000 },
      );
      this.staged.delete(uploadId);
      await unlink(path).catch(() => undefined);
      // Les caches en mémoire décrivaient la base d'avant.
      await this.registry.reload();
      await this.settings.get();
      const tables = [...counts.entries()].map(([table, rows]) => ({ table, rows }));
      const restoredRows = tables.reduce((sum, t) => sum + t.rows, 0);
      this.logger.log(
        `Full backup restored: ${restoredRows} rows in ${Math.round((Date.now() - started) / 1000)} s`,
      );
      return { restoredRows, tables, warnings };
    } finally {
      this.running = false;
    }
  }

  private async preview(uploadId: string, path: string): Promise<RestorePreview> {
    const { header, counts, fileOrder, warnings } = await this.scan(path);
    const plan = schemaBackupPlan();
    const currentSchema = await currentSchemaId(this.prisma);
    if (header.schema && currentSchema && header.schema !== currentSchema) {
      warnings.unshift(msg('platform.backupSchemaDiffers', { from: header.schema, to: currentSchema }));
    }
    if (!fileOrderCompatible(plan, fileOrder)) warnings.push(msg('platform.backupOrderFallback'));

    const tables = [];
    for (const table of [...plan.tables.map((t) => t.model), ...plan.joins]) {
      const inFile = counts.get(table) ?? 0;
      const current = await this.currentCount(table);
      if (inFile > 0 || current > 0) tables.push({ table, inFile, current });
    }
    return {
      uploadId,
      exportedAt: header.exportedAt,
      schema: header.schema,
      currentSchema,
      tables,
      totalRows: tables.reduce((sum, t) => sum + t.inFile, 0),
      warnings,
    };
  }

  /** Lecture complète : en-tête valide, marqueur de fin présent, tables et colonnes connues. */
  private async scan(path: string): Promise<{
    header: BackupHeader;
    counts: Map<string, number>;
    fileOrder: string[];
    warnings: string[];
  }> {
    const plan = schemaBackupPlan();
    const known = new Map(plan.tables.map((t) => [t.model, t]));
    const joins = new Set(plan.joins);
    let header: BackupHeader | null = null;
    let endRows: number | null = null;
    let rows = 0;
    const counts = new Map<string, number>();
    const fileOrder: string[] = [];
    const unknownColumns = new Map<string, Set<string>>();

    for await (const line of this.lines(path)) {
      if ('header' in line) {
        header = line.header;
        continue;
      }
      if ('end' in line) {
        endRows = line.end;
        continue;
      }
      const { t, r } = line.row;
      rows++;
      if (!counts.has(t)) fileOrder.push(t);
      counts.set(t, (counts.get(t) ?? 0) + 1);
      const table = known.get(t);
      if (!table) continue;
      const columns = new Set(table.columns.map((c) => c.name));
      for (const key of Object.keys(r)) {
        if (!columns.has(key)) {
          if (!unknownColumns.has(t)) unknownColumns.set(t, new Set());
          unknownColumns.get(t)!.add(key);
        }
      }
    }

    if (!header) throw new BadRequestException(msg('platform.backupInvalidFile'));
    if (endRows === null || endRows !== rows) throw new BadRequestException(msg('platform.backupTruncated'));

    const warnings: string[] = [];
    for (const [table, count] of counts) {
      if (!known.has(table) && !joins.has(table)) {
        warnings.push(msg('platform.backupUnknownTable', { table, count }));
      }
    }
    for (const [table, columns] of unknownColumns) {
      warnings.push(msg('platform.backupUnknownColumns', { table, columns: [...columns].join(', ') }));
    }
    return { header, counts, fileOrder, warnings };
  }

  private async *lines(path: string): AsyncGenerator<ParsedLine> {
    const input = createReadStream(path).pipe(createGunzip());
    const reader = createInterface({ input, crlfDelay: Infinity });
    let n = 0;
    try {
      for await (const text of reader) {
        n++;
        if (!text.trim()) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch (error) {
          throw new BadRequestException(
            msg('platform.backupUnreadable', { line: n, error: (error as Error).message }),
          );
        }
        yield this.classify(parsed, n);
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      // gunzip : un fichier qui n'est pas compressé, ou coupé au milieu d'un bloc.
      throw new BadRequestException(
        msg('platform.backupUnreadable', { line: n, error: (error as Error).message }),
      );
    }
  }

  private classify(parsed: unknown, n: number): ParsedLine {
    const value = (parsed ?? {}) as Record<string, unknown>;
    if (n === 1) {
      if (value.kind !== BACKUP_KIND) throw new BadRequestException(msg('platform.backupInvalidFile'));
      if (value.version !== BACKUP_VERSION) {
        throw new BadRequestException(
          msg('platform.backupUnsupportedVersion', {
            version: String(value.version),
            expected: BACKUP_VERSION,
          }),
        );
      }
      return { header: value as unknown as BackupHeader };
    }
    if (value.end === true) return { end: Number(value.rows) };
    if (typeof value.t === 'string' && value.r && typeof value.r === 'object') {
      return { row: value as unknown as BackupRowLine };
    }
    throw new BadRequestException(msg('platform.backupUnreadable', { line: n, error: 'unexpected line' }));
  }

  private async truncateAll(client: BackupClient): Promise<void> {
    const plan = schemaBackupPlan();
    const names = [...plan.tables.map((t) => t.table), ...plan.joins].map(quoteIdent).join(', ');
    await client.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
  }

  /** Ordre local, restreint aux tables du fichier ; les jointures en dernier. */
  private localOrder(fileOrder: string[]): string[] {
    const plan = schemaBackupPlan();
    const present = new Set(fileOrder);
    return [...plan.tables.map((t) => t.model), ...plan.joins].filter((t) => present.has(t));
  }

  /** Une passe sur le fichier ; `only` restreint à une table (repli quand l'ordre du fichier ne convient pas). */
  private async insertPass(
    client: BackupClient,
    path: string,
    only: string | null,
    counts: Map<string, number>,
  ): Promise<void> {
    const plan = schemaBackupPlan();
    const tables = new Map(plan.tables.map((t) => [t.model, t]));
    const joins = new Set(plan.joins);
    let current: string | null = null;
    let batch: Record<string, unknown>[] = [];
    let bytes = 0;

    const flush = async () => {
      if (!current || batch.length === 0) return;
      const table = tables.get(current);
      if (table) await this.insertRows(client, table, batch);
      else await this.insertJoinRows(client, current, batch);
      counts.set(current, (counts.get(current) ?? 0) + batch.length);
      batch = [];
      bytes = 0;
    };

    for await (const line of this.lines(path)) {
      if (!('row' in line)) continue;
      const { t, r } = line.row;
      if (only && t !== only) continue;
      if (!tables.has(t) && !joins.has(t)) continue;
      if (t !== current) {
        await flush();
        current = t;
      }
      batch.push(r);
      bytes += JSON.stringify(r).length;
      if (batch.length >= BATCH_ROWS || bytes >= BATCH_BYTES) await flush();
    }
    await flush();
  }

  private async insertRows(client: BackupClient, table: BackupTable, rows: Record<string, unknown>[]) {
    const data = rows.map((r) => decodeRow(table, r, JSON_NULLS).data);
    await delegateOf(client, table.model).createMany({ data });
  }

  private async insertJoinRows(client: BackupClient, join: string, rows: Record<string, unknown>[]) {
    const values: unknown[] = [];
    const tuples = rows.map((r) => {
      values.push(r.A, r.B);
      return `($${values.length - 1}, $${values.length})`;
    });
    await client.$executeRawUnsafe(
      `INSERT INTO ${quoteIdent(join)} ("A", "B") VALUES ${tuples.join(', ')}`,
      ...values,
    );
  }

  private async currentCount(table: string): Promise<number> {
    const model = schemaBackupPlan().tables.find((t) => t.model === table);
    if (model) return delegateOf(this.prisma, model.model).count();
    const [{ n }] = await this.prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM ${quoteIdent(table)}`,
    );
    return n;
  }

  private async purgeStale(): Promise<void> {
    const now = Date.now();
    for (const name of await readdir(STAGING_DIR).catch(() => [] as string[])) {
      const path = join(STAGING_DIR, name);
      const info = await stat(path).catch(() => null);
      if (info && now - info.mtimeMs > STAGING_TTL_MS) {
        await unlink(path).catch(() => undefined);
        this.staged.delete(name.replace(/\.ndjson\.gz$/, ''));
      }
    }
  }
}
