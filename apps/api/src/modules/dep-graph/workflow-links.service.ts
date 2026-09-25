import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, WorkflowLink } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface WorkflowLinkInput {
  fromWorkflowId: string;
  toWorkflowId: string;
  label?: string;
  note?: string;
}

/** Liens workflow → workflow saisis à la main (invisibles pour la détection automatique). */
@Injectable()
export class WorkflowLinksService {
  constructor(private readonly prisma: PrismaService) {}

  /** Liens manuels, limités aux workflows d'une instance si `instanceId` est fourni. */
  list(instanceId?: string): Promise<WorkflowLink[]> {
    return this.prisma.workflowLink.findMany({
      where: instanceId ? { from: { instanceId }, to: { instanceId } } : undefined,
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(input: WorkflowLinkInput): Promise<WorkflowLink> {
    const { fromWorkflowId, toWorkflowId } = input;
    if (!fromWorkflowId || !toWorkflowId)
      throw new BadRequestException('Workflow de départ et d’arrivée requis');
    if (fromWorkflowId === toWorkflowId)
      throw new BadRequestException('Un workflow ne peut pas se lier à lui-même');

    const known = await this.prisma.workflow.count({ where: { id: { in: [fromWorkflowId, toWorkflowId] } } });
    if (known < 2) throw new NotFoundException('Workflow inconnu — synchronise l’instance puis réessaie');

    try {
      return await this.prisma.workflowLink.create({
        data: {
          fromWorkflowId,
          toWorkflowId,
          label: input.label?.trim() ?? '',
          note: input.note?.trim() || null,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Ces deux workflows sont déjà liés dans ce sens');
      }
      throw error;
    }
  }

  async update(id: string, input: Pick<WorkflowLinkInput, 'label' | 'note'>): Promise<WorkflowLink> {
    await this.get(id);
    return this.prisma.workflowLink.update({
      where: { id },
      data: {
        ...(input.label === undefined ? {} : { label: input.label.trim() }),
        ...(input.note === undefined ? {} : { note: input.note.trim() || null }),
      },
    });
  }

  async delete(id: string): Promise<WorkflowLink> {
    await this.get(id);
    return this.prisma.workflowLink.delete({ where: { id } });
  }

  private async get(id: string): Promise<WorkflowLink> {
    const link = await this.prisma.workflowLink.findUnique({ where: { id } });
    if (!link) throw new NotFoundException(`Lien inconnu : ${id}`);
    return link;
  }
}
