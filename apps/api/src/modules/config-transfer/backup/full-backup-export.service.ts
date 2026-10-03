import { Injectable, Logger } from '@nestjs/common';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { sealingStream } from '../../../infra/secrets/export-file-cipher';
import { requireExportKey } from '../export-key-errors';
import { BACKUP_KIND, BACKUP_VERSION, BackupEndLine, BackupHeader } from './backup-format';
import { BackupTable, encodeRow } from './backup-plan';
import { currentSchemaId, delegateOf, quoteIdent, schemaBackupPlan } from './prisma-backup-access';

/** Petit : une ligne de `Workflow` porte tout le JSON du workflow. */
const PAGE = 200;

/**
 * Sauvegarde COMPLÈTE : toutes les tables, historique compris (versions,
 * erreurs, exécutions, coûts IA, conversations, leçons, procédures…), secrets
 * compris. À côté de l'export de configuration, pas à sa place : lui voyage
 * d'une plateforme à une AUTRE et fusionne par clés naturelles ; celle-ci
 * remet la MÊME plateforme dans l'état exact de la sauvegarde, ids compris.
 */
@Injectable()
export class FullBackupExportService {
  private readonly logger = new Logger(FullBackupExportService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Le fichier ENTIER est scellé par la clé d'export (cf. export-file-cipher) :
   * il porte des secrets dans des colonnes qu'aucune liste ne tient, et il est
   * écrit déchiffré (le client Prisma déchiffre ce qu'il lit), donc portable
   * vers une plateforme qui a une autre `SECRETS_KEY`.
   */
  async write(out: Writable, exportKey?: string): Promise<void> {
    requireExportKey(exportKey);
    const started = Date.now();
    const counter = { rows: 0 };
    await pipeline(Readable.from(this.lines(counter)), createGzip(), sealingStream(exportKey), out);
    this.logger.log(
      `Full backup written: ${counter.rows} rows in ${Math.round((Date.now() - started) / 1000)} s`,
    );
  }

  private async *lines(counter: { rows: number }): AsyncGenerator<string> {
    yield JSON.stringify(await this.header()) + '\n';
    for (const table of schemaBackupPlan().tables) {
      for await (const row of this.rowsOf(table)) {
        counter.rows++;
        yield JSON.stringify({ t: table.model, r: encodeRow(table, row) }) + '\n';
      }
    }
    for (const join of schemaBackupPlan().joins) {
      for (const row of await this.joinRows(join)) {
        counter.rows++;
        yield JSON.stringify({ t: join, r: row }) + '\n';
      }
    }
    const end: BackupEndLine = { end: true, rows: counter.rows };
    yield JSON.stringify(end) + '\n';
  }

  private async header(): Promise<BackupHeader> {
    const plan = schemaBackupPlan();
    const tables = await Promise.all(
      plan.tables.map(async (t) => ({
        table: t.model,
        count: await delegateOf(this.prisma, t.model).count(),
      })),
    );
    const joins = await Promise.all(
      plan.joins.map(async (join) => {
        const [{ n }] = await this.prisma.$queryRawUnsafe<{ n: number }[]>(
          `SELECT COUNT(*)::int AS n FROM ${quoteIdent(join)}`,
        );
        return { table: join, count: n };
      }),
    );
    return {
      kind: BACKUP_KIND,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      schema: await currentSchemaId(this.prisma),
      tables: [...tables, ...joins],
    };
  }

  /** Pagination par clé (curseur) quand l'id est simple ; par décalage sur une clé composée. */
  private async *rowsOf(table: BackupTable): AsyncGenerator<Record<string, unknown>> {
    const delegate = delegateOf(this.prisma, table.model);
    const orderBy = table.idFields.map((f) => ({ [f]: 'asc' }));
    const single = table.idFields.length === 1 ? table.idFields[0] : null;
    let cursor: unknown = undefined;
    let offset = 0;
    for (;;) {
      const page = await delegate.findMany({
        take: PAGE,
        orderBy,
        ...(single && cursor !== undefined ? { cursor: { [single]: cursor }, skip: 1 } : {}),
        ...(single ? {} : { skip: offset }),
      });
      for (const row of page) yield row;
      if (page.length < PAGE) return;
      offset += page.length;
      if (single) cursor = page[page.length - 1][single];
    }
  }

  private joinRows(join: string): Promise<{ A: string; B: string }[]> {
    return this.prisma.$queryRawUnsafe<{ A: string; B: string }[]>(
      `SELECT "A", "B" FROM ${quoteIdent(join)} ORDER BY "A", "B"`,
    );
  }
}
