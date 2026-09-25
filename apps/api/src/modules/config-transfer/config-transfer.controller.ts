import { Body, Controller, ForbiddenException, Get, Post, Query } from '@nestjs/common';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';
import { ConfigExportService } from './config-export.service';
import { ConfigImportService } from './config-import.service';
import { ConfigBundle, ImportReport, ImportStrategy } from './config-bundle.types';
import { CONFIG_EXPORT_ENV, isConfigExportEnabled } from './config-export.policy';

@ModuleId('config-transfer')
@Controller('config-transfer')
export class ConfigTransferController {
  constructor(
    private readonly exporter: ConfigExportService,
    private readonly importer: ConfigImportService,
  ) {}

  /** Ce que l'UI a le droit de proposer sur cette installation (cf. config-export.policy). */
  @Get('capabilities')
  capabilities(): { exportEnabled: boolean } {
    return { exportEnabled: isConfigExportEnabled() };
  }

  /** Bundle JSON de toute la config ; ?includeSecrets=false pour un export anonymisé. */
  @Get('export')
  export(@Query('includeSecrets') includeSecrets?: string): Promise<ConfigBundle> {
    if (!isConfigExportEnabled()) {
      throw new ForbiddenException(
        `Export de configuration désactivé sur cette installation (${CONFIG_EXPORT_ENV} non posé). ` +
          "Il ne s'ouvre qu'en local, où le fichier ne quitte pas la machine.",
      );
    }
    return this.exporter.buildBundle(includeSecrets !== 'false');
  }

  /** Import d'un bundle ; dryRun=true renvoie le rapport sans rien écrire. */
  @Post('import')
  import(
    @Body() body: { bundle: ConfigBundle; strategy?: ImportStrategy; dryRun?: boolean },
  ): Promise<ImportReport> {
    return this.importer.importBundle(body.bundle, body.strategy ?? 'merge', body.dryRun ?? false);
  }
}
