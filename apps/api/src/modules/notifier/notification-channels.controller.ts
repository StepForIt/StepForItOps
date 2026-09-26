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
import { Response } from 'express';
import { msg } from '@nwm/core';
import { NotificationChannel } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';
import { RefineListQuery, toPrismaListArgs, withTotalCount } from '../../common/crud/paginate';
import { NOTIFIER_MANIFEST } from './manifest';
import { NotifierService, TestResult } from './notifier.service';

const CHANNEL_TYPES = new Set(['slack', 'webhook']);

/** Vue d'un canal : l'URL (le secret) n'en sort jamais, seule sa fin identifie le canal. */
export interface ChannelView {
  id: string;
  name: string;
  type: string;
  /** « …/T0XX/B0YY/xxx » tronqué : assez pour reconnaître le canal, pas pour l'appeler. */
  urlHint: string;
  enabled: boolean;
  onNewGroup: boolean;
  onRegression: boolean;
  onPerfDrift: boolean;
  onBudget: boolean;
  onRelayBroken: boolean;
  onModelLifecycle: boolean;
  createdAt: Date;
}

export interface ChannelBody {
  name?: string;
  type?: string;
  /** Absente en édition = URL inchangée. */
  url?: string;
  enabled?: boolean;
  onNewGroup?: boolean;
  onRegression?: boolean;
  onPerfDrift?: boolean;
  onBudget?: boolean;
  onRelayBroken?: boolean;
  onModelLifecycle?: boolean;
}

/** Canaux d'alerte (resource Refine « notification-channels »). */
@ModuleId(NOTIFIER_MANIFEST.id)
@Controller('notification-channels')
export class NotificationChannelsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: NotifierService,
  ) {}

  @Get()
  async list(
    @Query() query: RefineListQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ChannelView[]> {
    const { skip, take, orderBy } = toPrismaListArgs(query, 'createdAt', 'asc');
    const [rows, total] = await Promise.all([
      this.prisma.notificationChannel.findMany({ orderBy, skip, take }),
      this.prisma.notificationChannel.count(),
    ]);
    return withTotalCount(res, total, rows.map(toView));
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<ChannelView> {
    const row = await this.prisma.notificationChannel.findUniqueOrThrow({ where: { id } });
    return toView(row);
  }

  @Post()
  async create(@Body() body: ChannelBody): Promise<ChannelView> {
    const { name, type, url } = body;
    if (!name?.trim()) throw new BadRequestException(msg('ops.channelNameRequired'));
    if (!type || !CHANNEL_TYPES.has(type)) throw new BadRequestException(msg('ops.channelTypeInvalid'));
    validateUrl(url);
    const row = await this.prisma.notificationChannel.create({
      data: {
        name: name.trim(),
        type,
        url: url!,
        enabled: body.enabled ?? true,
        onNewGroup: body.onNewGroup ?? true,
        onRegression: body.onRegression ?? true,
        onPerfDrift: body.onPerfDrift ?? true,
        onBudget: body.onBudget ?? true,
        onRelayBroken: body.onRelayBroken ?? true,
        onModelLifecycle: body.onModelLifecycle ?? true,
      },
    });
    return toView(row);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: ChannelBody): Promise<ChannelView> {
    if (body.type !== undefined && !CHANNEL_TYPES.has(body.type)) {
      throw new BadRequestException(msg('ops.channelTypeInvalid'));
    }
    // URL vide ou absente = on garde le secret en place (l'UI ne l'a jamais reçue).
    if (body.url) validateUrl(body.url);
    const row = await this.prisma.notificationChannel.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.url ? { url: body.url } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.onNewGroup !== undefined ? { onNewGroup: body.onNewGroup } : {}),
        ...(body.onRegression !== undefined ? { onRegression: body.onRegression } : {}),
        ...(body.onPerfDrift !== undefined ? { onPerfDrift: body.onPerfDrift } : {}),
        ...(body.onBudget !== undefined ? { onBudget: body.onBudget } : {}),
        ...(body.onRelayBroken !== undefined ? { onRelayBroken: body.onRelayBroken } : {}),
        ...(body.onModelLifecycle !== undefined ? { onModelLifecycle: body.onModelLifecycle } : {}),
      },
    });
    return toView(row);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ id: string }> {
    await this.prisma.notificationChannel.delete({ where: { id } });
    return { id };
  }

  /** Envoie un message d'essai sur le canal. */
  @Post(':id/test')
  test(@Param('id') id: string): Promise<TestResult> {
    return this.notifier.test(id);
  }
}

function validateUrl(url: string | undefined): void {
  if (!url) throw new BadRequestException(msg('ops.channelUrlRequired'));
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error();
  } catch {
    throw new BadRequestException(msg('ops.channelUrlInvalid'));
  }
}

function toView(row: NotificationChannel): ChannelView {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    urlHint: `…${row.url.slice(-12)}`,
    enabled: row.enabled,
    onNewGroup: row.onNewGroup,
    onRegression: row.onRegression,
    onPerfDrift: row.onPerfDrift,
    onBudget: row.onBudget,
    onRelayBroken: row.onRelayBroken,
    onModelLifecycle: row.onModelLifecycle,
    createdAt: row.createdAt,
  };
}
