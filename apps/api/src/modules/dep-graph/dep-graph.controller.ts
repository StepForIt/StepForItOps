import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { DepGraphAliasService } from './dep-graph-alias.service';
import { ResourceSummary, ResourceUsageResult, ResourceUsageService } from './resource-usage.service';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';

@ModuleId('dep-graph')
@Controller('dep-graph')
export class DepGraphController {
  constructor(
    private readonly aliases: DepGraphAliasService,
    private readonly resourceUsage: ResourceUsageService,
  ) {}

  /**
   * Inventaire des ressources externes touchées par au moins un nœud. La prod
   * seule par défaut : `includeOtherEnvs=1` ramène dev et preprod, dont les
   * exemplaires comptaient plusieurs fois le même usage.
   */
  @Get('resources')
  resources(
    @Query('instanceId') instanceId?: string,
    @Query('q') q?: string,
    @Query('includeOtherEnvs') includeOtherEnvs?: string,
  ): Promise<ResourceSummary[]> {
    return this.resourceUsage.resources({ instanceId, q, includeOtherEnvs: includeOtherEnvs === '1' });
  }

  /** Détail d'une ressource : les nœuds qui la touchent, champ par champ quand elle en a. */
  @Get('resources/usage')
  usage(
    @Query('key') key: string,
    @Query('column') column?: string,
    @Query('instanceId') instanceId?: string,
    @Query('includeOtherEnvs') includeOtherEnvs?: string,
  ): Promise<ResourceUsageResult> {
    return this.resourceUsage.usage({
      key,
      column,
      instanceId,
      includeOtherEnvs: includeOtherEnvs === '1',
    });
  }

  /**
   * Nom lisible posé à la main. Il survit à tout et sert aussi de rattachement :
   * rien dans le JSON n8n ne dit qu'un hôte donné *est* le NocoDB de la maison,
   * c'est l'alias qui le déclare — et qui le rend cherchable sous ce nom.
   */
  @Post('alias')
  rename(@Body() body: { key: string; label: string }): Promise<{ key: string; label: string }> {
    return this.aliases.rename(body.key, body.label);
  }
}
