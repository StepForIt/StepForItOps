import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { msg } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PrismaListArgs } from '../../common/crud/paginate';

export interface GroupInput {
  name: string;
  instanceId: string;
  workflowIds?: string[];
}

/** Groupe avec ses membres (forme renvoyée à l'UI Refine). */
export interface GroupRow {
  id: string;
  name: string;
  instanceId: string;
  instanceName: string;
  workflowIds: string[];
  workflows: Array<{ id: string; name: string }>;
  createdAt: Date;
  updatedAt: Date;
}

const INCLUDE = {
  instance: { select: { name: true } },
  workflows: { select: { id: true, name: true }, orderBy: { name: 'asc' as const } },
};

type GroupRecord = {
  id: string;
  name: string;
  instanceId: string;
  createdAt: Date;
  updatedAt: Date;
  instance: { name: string };
  workflows: Array<{ id: string; name: string }>;
};

function toRow(group: GroupRecord): GroupRow {
  return {
    id: group.id,
    name: group.name,
    instanceId: group.instanceId,
    instanceName: group.instance.name,
    workflowIds: group.workflows.map((w) => w.id),
    workflows: group.workflows,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

@Injectable()
export class WorkflowGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    args: PrismaListArgs,
    filters: { instanceId?: string },
  ): Promise<{ data: GroupRow[]; total: number }> {
    const where = filters.instanceId ? { instanceId: filters.instanceId } : undefined;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.workflowGroup.findMany({ ...args, where, include: INCLUDE }),
      this.prisma.workflowGroup.count({ where }),
    ]);
    return { data: rows.map(toRow), total };
  }

  async get(id: string): Promise<GroupRow> {
    const group = await this.prisma.workflowGroup.findUnique({ where: { id }, include: INCLUDE });
    if (!group) throw new NotFoundException(msg('platform.groupUnknown', { id }));
    return toRow(group);
  }

  async create(input: GroupInput): Promise<GroupRow> {
    if (!input.name?.trim() || !input.instanceId) {
      throw new BadRequestException(msg('platform.groupNameInstanceRequired'));
    }
    const group = await this.prisma.workflowGroup.create({
      data: {
        name: input.name.trim(),
        instanceId: input.instanceId,
        workflows: { connect: (input.workflowIds ?? []).map((id) => ({ id })) },
      },
      include: INCLUDE,
    });
    return toRow(group);
  }

  async update(id: string, input: Partial<GroupInput>): Promise<GroupRow> {
    const group = await this.prisma.workflowGroup.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.instanceId !== undefined ? { instanceId: input.instanceId } : {}),
        ...(input.workflowIds !== undefined
          ? { workflows: { set: input.workflowIds.map((wid) => ({ id: wid })) } }
          : {}),
      },
      include: INCLUDE,
    });
    return toRow(group);
  }

  async delete(id: string): Promise<{ id: string }> {
    await this.prisma.workflowGroup.delete({ where: { id } });
    return { id };
  }
}
