import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';
import { RefineListQuery, toPrismaListArgs, withTotalCount } from '../../common/crud/paginate';
import { GroupInput, GroupRow, WorkflowGroupsService } from './workflow-groups.service';

@ModuleId('workflow-groups')
@Controller('workflow-groups')
export class WorkflowGroupsController {
  constructor(private readonly groups: WorkflowGroupsService) {}

  @Get()
  async list(
    @Query() query: RefineListQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<GroupRow[]> {
    // `instanceName` est dérivé côté service : on trie sur la relation Prisma
    if (query._sort === 'instanceName') query._sort = 'instance.name';
    const { data, total } = await this.groups.list(toPrismaListArgs(query, 'name', 'asc'), {
      instanceId: query.instanceId,
    });
    return withTotalCount(res, total, data);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<GroupRow> {
    return this.groups.get(id);
  }

  @Post()
  create(@Body() body: GroupInput): Promise<GroupRow> {
    return this.groups.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Partial<GroupInput>): Promise<GroupRow> {
    return this.groups.update(id, body);
  }

  @Delete(':id')
  delete(@Param('id') id: string): Promise<{ id: string }> {
    return this.groups.delete(id);
  }
}
