import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { WorkflowLink } from '@prisma/client';
import { WorkflowMapService, WorkflowMapView } from './workflow-map.service';
import { WorkflowLinkInput, WorkflowLinksService } from './workflow-links.service';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';

@ModuleId('dep-graph')
@Controller('workflow-map')
export class WorkflowMapController {
  constructor(
    private readonly map: WorkflowMapService,
    private readonly links: WorkflowLinksService,
  ) {}

  @Get()
  view(@Query('instanceId') instanceId?: string): Promise<WorkflowMapView> {
    return this.map.map(instanceId);
  }

  @Get('links')
  listLinks(@Query('instanceId') instanceId?: string): Promise<WorkflowLink[]> {
    return this.links.list(instanceId);
  }

  @Post('links')
  createLink(@Body() input: WorkflowLinkInput): Promise<WorkflowLink> {
    return this.links.create(input);
  }

  @Patch('links/:id')
  updateLink(
    @Param('id') id: string,
    @Body() input: { label?: string; note?: string },
  ): Promise<WorkflowLink> {
    return this.links.update(id, input);
  }

  @Delete('links/:id')
  deleteLink(@Param('id') id: string): Promise<WorkflowLink> {
    return this.links.delete(id);
  }
}
