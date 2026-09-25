import { PlatformId } from '@nwm/core';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { InstanceInput, InstancesService, InstanceView } from './instances.service';
import { RefineListQuery, toPrismaListArgs, withTotalCount } from '../../common/crud/paginate';

/** Les réponses n'exposent jamais la clé API : uniquement le drapeau `hasApiKey`. */
@Controller('instances')
export class InstancesController {
  constructor(private readonly instances: InstancesService) {}

  @Get()
  async list(
    @Query() query: RefineListQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<InstanceView[]> {
    const { orderBy } = toPrismaListArgs(query, 'name', 'asc');
    const all = await this.instances.list({ orderBy });
    return withTotalCount(res, all.length, all);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<InstanceView> {
    return this.instances.get(id);
  }

  @Post()
  create(@Body() input: InstanceInput): Promise<InstanceView> {
    return this.instances.create(input);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() input: Partial<InstanceInput>): Promise<InstanceView> {
    return this.instances.update(id, input);
  }

  @Delete(':id')
  delete(@Param('id') id: string): Promise<InstanceView> {
    return this.instances.delete(id);
  }

  /** Test d'identifiants avant sauvegarde (formulaire). `instanceId` permet de tester sans ressaisir la clé. */
  @Post('test-config')
  testConfig(
    @Body()
    body: {
      baseUrl: string;
      apiKey?: string;
      instanceId?: string;
      platform?: PlatformId;
      zone?: string;
      orgId?: string;
      teamId?: string;
    },
  ): Promise<{ ok: boolean; workflowCount?: number; error?: string }> {
    return this.instances.testConfig(
      {
        baseUrl: body.baseUrl,
        apiKey: body.apiKey,
        platform: body.platform,
        zone: body.zone,
        orgId: body.orgId,
        teamId: body.teamId,
      },
      body.instanceId,
    );
  }

  /** Ce que la plateforme de cette instance sait faire (cf. `PlatformCapabilities`). */
  @Get(':id/capabilities')
  capabilities(@Param('id') id: string) {
    return this.instances.capabilities(id);
  }

  @Post(':id/test')
  test(@Param('id') id: string): Promise<{ ok: boolean; workflowCount?: number; error?: string }> {
    return this.instances.testConnection(id);
  }
}
