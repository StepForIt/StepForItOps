import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { msg } from '@nwm/core';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';
import { ConfigExportService } from './config-export.service';
import { ConfigImportService } from './config-import.service';
import { ConfigBundle, ImportReport, ImportStrategy } from './config-bundle.types';
import { CONFIG_EXPORT_ENV, isConfigExportEnabled } from './config-export.policy';
import { FullBackupExportService } from './backup/full-backup-export.service';
import { FullBackupRestoreService } from './backup/full-backup-restore.service';
import { RestorePreview, RestoreResult } from './backup/backup-format';
import { requireExportKey } from './export-key-errors';

@ModuleId('config-transfer')
@Controller('config-transfer')
export class ConfigTransferController {
  constructor(
    private readonly exporter: ConfigExportService,
    private readonly importer: ConfigImportService,
    private readonly backupExporter: FullBackupExportService,
    private readonly backupRestorer: FullBackupRestoreService,
  ) {}

  /** Ce que l'UI a le droit de proposer sur cette installation (cf. config-export.policy). */
  @Get('capabilities')
  capabilities(): { exportEnabled: boolean } {
    return { exportEnabled: isConfigExportEnabled() };
  }

  /**
   * Sauvegarde COMPLÈTE (toutes les tables, historique et secrets compris), en flux
   * `.ndjson.gz` scellé par la clé d'export. Même porte que l'export de configuration :
   * elle sort encore plus. En POST (formulaire) : la clé n'a rien à faire dans une URL,
   * que les journaux d'accès et l'historique du navigateur gardent.
   */
  @Post('backup')
  @HttpCode(200)
  async backup(@Body() body: { exportKey?: string }, @Res() res: Response): Promise<void> {
    this.assertExportEnabled();
    // Avant les en-têtes : un refus doit encore pouvoir partir en 400.
    requireExportKey(body?.exportKey);
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="nwm-backup-${day}.ndjson.gz.sealed"`);
    await this.backupExporter.write(res, body.exportKey);
  }

  /**
   * Téléverse une sauvegarde (corps brut) : rien n'est écrit, l'aperçu dit ce qui serait
   * remplacé. La clé d'export voyage en en-tête, le corps étant le fichier lui-même.
   */
  @Post('restore/upload')
  restoreUpload(@Req() req: Request, @Headers('x-export-key') exportKey?: string): Promise<RestorePreview> {
    return this.backupRestorer.stage(req, exportKey);
  }

  /** Remplace TOUTES les données par celles de la sauvegarde téléversée. */
  @Post('restore/:uploadId/apply')
  restoreApply(
    @Param('uploadId') uploadId: string,
    @Body() body: { confirm?: boolean },
  ): Promise<RestoreResult> {
    return this.backupRestorer.apply(uploadId, body?.confirm === true);
  }

  /**
   * Bundle JSON de toute la config, SANS secrets. Les secrets ne sortent que par
   * `POST /export`, scellés par une clé d'export qu'une URL ne doit pas porter.
   */
  @Get('export')
  export(): Promise<ConfigBundle> {
    this.assertExportEnabled();
    return this.exporter.buildBundle(false);
  }

  /** Bundle avec secrets, scellés par la clé d'export ; `includeSecrets: false` = comme le GET. */
  @Post('export')
  @HttpCode(200)
  exportSealed(@Body() body: { includeSecrets?: boolean; exportKey?: string }): Promise<ConfigBundle> {
    this.assertExportEnabled();
    return this.exporter.buildBundle(body?.includeSecrets !== false, body?.exportKey);
  }

  /** Import d'un bundle ; dryRun=true renvoie le rapport sans rien écrire. Fichier scellé ⇒ `exportKey`. */
  @Post('import')
  import(
    @Body()
    body: {
      bundle: ConfigBundle;
      strategy?: ImportStrategy;
      dryRun?: boolean;
      exportKey?: string;
    },
  ): Promise<ImportReport> {
    return this.importer.importBundle(
      body.bundle,
      body.strategy ?? 'merge',
      body.dryRun ?? false,
      body.exportKey,
    );
  }

  private assertExportEnabled(): void {
    if (!isConfigExportEnabled()) {
      throw new ForbiddenException(msg('platform.configExportDisabled', { envVar: CONFIG_EXPORT_ENV }));
    }
  }
}
