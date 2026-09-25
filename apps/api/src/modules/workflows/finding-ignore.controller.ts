import { Body, Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { FindingIgnore, Prisma } from '@prisma/client';
import { RefineListQuery, toPrismaListArgs, withTotalCount } from '../../common/crud/paginate';
import { FindingIgnoreService, IgnoreNodeScope, IgnoreScope } from './finding-ignore.service';

interface CreateIgnoreBody {
  module: string;
  code: string;
  workflowId?: string | null;
  /** Portée « tous les environnements » : clé de famille du workflow métier. */
  familyKey?: string | null;
  nodeName?: string | null;
  reason?: string;
}

interface IgnoreFromFindingBody {
  scope?: IgnoreScope;
  nodeScope?: IgnoreNodeScope;
  reason?: string;
}

/** Resource transverse "finding-ignores" : findings déclarés normaux/voulus. */
@Controller('finding-ignores')
export class FindingIgnoreController {
  constructor(private readonly ignores: FindingIgnoreService) {}

  @Get()
  async list(
    @Query() query: RefineListQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<FindingIgnore[]> {
    const where: Prisma.FindingIgnoreWhereInput = {
      ...(query.workflowId ? { OR: [{ workflowId: query.workflowId }, { workflowId: null }] } : {}),
      ...(query.instanceId ? { workflow: { instanceId: query.instanceId } } : {}),
      ...(query.module ? { module: query.module } : {}),
    };
    const [data, total] = await Promise.all([
      this.ignores.list(where, toPrismaListArgs(query)),
      this.ignores.count(where),
    ]);
    return withTotalCount(res, total, data);
  }

  @Post()
  create(@Body() body: CreateIgnoreBody): Promise<FindingIgnore> {
    return this.ignores.create(body);
  }

  /** Ignore un finding existant : crée la règle et purge les findings couverts. */
  @Post('from-finding/:findingId')
  createFromFinding(
    @Param('findingId') findingId: string,
    @Body() body: IgnoreFromFindingBody,
  ): Promise<FindingIgnore> {
    return this.ignores.createFromFinding(findingId, body ?? {});
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<FindingIgnore> {
    return this.ignores.remove(id);
  }
}
