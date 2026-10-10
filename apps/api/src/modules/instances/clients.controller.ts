import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { msg } from '@nwm/core';
import { Response } from 'express';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RefineListQuery, toPrismaListArgs, withTotalCount } from '../../common/crud/paginate';

export interface ClientView {
  id: string;
  name: string;
  instanceCount: number;
  /** Workflows affectés directement à ce client (en plus de ceux de ses instances). */
  workflowCount: number;
  /** Espace client : exécutions du jour montrées ? */
  portalShowToday: boolean;
  /** Espace client : incidents en cours (quel workflow, quel impact) montrés ? */
  portalShowIncidents: boolean;
  createdAt: Date;
}

export interface ClientUpdate {
  name?: string;
  portalShowToday?: boolean;
  portalShowIncidents?: boolean;
}

/**
 * Clients de l'agence (resource Refine « clients ») : de simples groupes
 * d'instances pour les vues agrégées — module core (avec `instances`), aucune
 * isolation de données derrière.
 */
@Controller('clients')
export class ClientsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Query() query: RefineListQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ClientView[]> {
    const { orderBy } = toPrismaListArgs(query, 'name', 'asc');
    const rows = await this.prisma.client.findMany({
      orderBy,
      include: { _count: { select: { instances: true, workflows: true } } },
    });
    return withTotalCount(
      res,
      rows.length,
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        instanceCount: row._count.instances,
        workflowCount: row._count.workflows,
        portalShowToday: row.portalShowToday,
        portalShowIncidents: row.portalShowIncidents,
        createdAt: row.createdAt,
      })),
    );
  }

  @Post()
  create(@Body() body: { name?: string }): Promise<{ id: string; name: string }> {
    const name = body.name?.trim();
    if (!name) throw new BadRequestException(msg('platform.nameRequired'));
    return this.prisma.client.create({ data: { name }, select: { id: true, name: true } });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: ClientUpdate): Promise<{ id: string; name: string }> {
    const data: ClientUpdate = {};
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) throw new BadRequestException(msg('platform.nameRequired'));
      data.name = name;
    }
    if (typeof body.portalShowToday === 'boolean') data.portalShowToday = body.portalShowToday;
    if (typeof body.portalShowIncidents === 'boolean') data.portalShowIncidents = body.portalShowIncidents;
    if (Object.keys(data).length === 0) throw new BadRequestException(msg('platform.nameRequired'));
    return this.prisma.client.update({ where: { id }, data, select: { id: true, name: true } });
  }

  /** Les instances rattachées ne sont pas supprimées : leur clientId repasse à null. */
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ id: string }> {
    await this.prisma.client.delete({ where: { id } });
    return { id };
  }
}
