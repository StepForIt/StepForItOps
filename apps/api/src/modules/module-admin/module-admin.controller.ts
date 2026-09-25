import { Body, Controller, Get, Param, Patch, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { ModuleRegistryService } from '../../infra/modules-registry/module-registry.service';
import { RefineListQuery, withTotalCount } from '../../common/crud/paginate';

interface ModuleView {
  id: string;
  name: string;
  description: string;
  core: boolean;
  enabled: boolean;
}

@Controller('modules')
export class ModuleAdminController {
  constructor(private readonly registry: ModuleRegistryService) {}

  @Get()
  async list(
    @Query() _query: RefineListQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ModuleView[]> {
    const manifests = this.registry.listManifests();
    const views = await Promise.all(
      manifests.map(async (m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        core: m.core ?? false,
        enabled: await this.registry.isEnabled(m.id),
      })),
    );
    return withTotalCount(res, views.length, views);
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<ModuleView> {
    const manifest = this.registry.listManifests().find((m) => m.id === id);
    return {
      id,
      name: manifest?.name ?? id,
      description: manifest?.description ?? '',
      core: manifest?.core ?? false,
      enabled: await this.registry.isEnabled(id),
    };
  }

  @Patch(':id')
  async toggle(@Param('id') id: string, @Body() body: { enabled: boolean }): Promise<ModuleView> {
    await this.registry.setEnabled(id, body.enabled);
    return this.get(id);
  }
}
