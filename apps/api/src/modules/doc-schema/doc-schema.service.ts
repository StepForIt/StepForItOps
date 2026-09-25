import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  AI_PORT,
  AiGenerateParams,
  AiPort,
  EVENTS,
  N8nWorkflow,
  blueprintDocContext,
  isMakeBlueprint,
  makeMermaid,
  redactSecrets,
  workflowToMermaid,
} from '@nwm/core';
import { WorkflowDoc } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EventBusService } from '../../infra/events/event-bus.service';
import { WorkflowsService } from '../workflows/workflows.service';

@Injectable()
export class DocSchemaService {
  private readonly logger = new Logger(DocSchemaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly workflows: WorkflowsService,
    @Inject(AI_PORT) private readonly ai: AiPort,
  ) {}

  /**
   * Schéma Mermaid et résumé IA, chacun lu par le code de la plateforme du
   * workflow : un blueprint Make n'a ni `nodes` ni `connections`, et le schéma
   * comme le résumé s'y lisent sur l'imbrication des modules.
   */
  async generate(workflowId: string, withAi: boolean): Promise<WorkflowDoc> {
    const { workflow, raw } = await this.workflows.getRawAny(workflowId);
    const { mermaid, request } =
      workflow.platform === 'make' ? this.makeDoc(raw, workflow.name) : this.n8nDoc(raw as N8nWorkflow);

    let summary: string | undefined;
    if (withAi && (await this.ai.isConfigured())) {
      try {
        summary = await this.ai.generate({ ...request, maxTokens: 2048 });
      } catch (error) {
        this.logger.warn(`Résumé IA KO : ${(error as Error).message}`);
      }
    }

    const doc = await this.prisma.workflowDoc.upsert({
      where: { workflowId },
      create: { workflowId, mermaid, summary },
      update: { mermaid, ...(summary !== undefined ? { summary } : {}) },
    });
    this.eventBus.emit(EVENTS.docGenerated, { workflowId });
    return doc;
  }

  private n8nDoc(raw: N8nWorkflow): {
    mermaid: string;
    request: Pick<AiGenerateParams, 'system' | 'prompt'>;
  } {
    return {
      mermaid: workflowToMermaid(raw),
      request: {
        system:
          'Tu documentes un workflow n8n pour un humain. En français, en markdown court : ' +
          "**But**, **Déclencheur**, **Entrées/Sorties**, **Systèmes touchés**, **Points d'attention**.",
        prompt: JSON.stringify({
          name: raw.name,
          // Un secret saisi en dur dans un nœud n'a rien à faire chez le fournisseur d'IA.
          nodes: raw.nodes.map((n) => ({
            name: n.name,
            type: n.type,
            parameters: redactSecrets(n.parameters),
          })),
          connections: raw.connections,
        }),
      },
    };
  }

  private makeDoc(
    raw: unknown,
    workflowName: string,
  ): { mermaid: string; request: Pick<AiGenerateParams, 'system' | 'prompt'> } {
    if (!isMakeBlueprint(raw)) {
      throw new BadRequestException(
        `« ${workflowName} » : contenu illisible comme blueprint Make, rien à documenter.`,
      );
    }
    return {
      mermaid: makeMermaid(raw),
      request: {
        system:
          'Tu documentes un scénario Make pour un humain. Les modules sont désignés par leur id ; ' +
          '"links" dit qui suit qui, et une route ou une branche est EXCLUSIVE de ses sœurs. ' +
          'Le premier module est le déclencheur. En français, en markdown court : ' +
          "**But**, **Déclencheur**, **Entrées/Sorties**, **Systèmes touchés**, **Points d'attention**.",
        prompt: JSON.stringify(blueprintDocContext(raw, workflowName)),
      },
    };
  }

  get(workflowId: string): Promise<WorkflowDoc | null> {
    return this.prisma.workflowDoc.findUnique({ where: { workflowId } });
  }
}
