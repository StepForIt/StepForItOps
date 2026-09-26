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
  msg,
  redactSecrets,
  workflowToMermaid,
  writeInLanguage,
} from '@nwm/core';
import { WorkflowDoc } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EventBusService } from '../../infra/events/event-bus.service';
import { WorkflowsService } from '../workflows/workflows.service';

/** Les rubriques du résumé ; leurs titres suivent la langue de sortie. */
const DOC_SECTIONS =
  '**Purpose**, **Trigger**, **Inputs/Outputs**, **Systems touched**, **Points of attention** ' +
  '(section titles translated into the output language).';

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
        this.logger.warn(`AI summary failed: ${(error as Error).message}`);
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
        system: `You document an n8n workflow for a human, in short markdown: ${DOC_SECTIONS} ${writeInLanguage()}`,
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
      throw new BadRequestException(msg('analysis.docUnreadableBlueprint', { name: workflowName }));
    }
    return {
      mermaid: makeMermaid(raw),
      request: {
        system:
          'You document a Make scenario for a human. Modules are designated by their id; ' +
          '"links" says what follows what, and a route or a branch is EXCLUSIVE of its siblings. ' +
          `The first module is the trigger. In short markdown: ${DOC_SECTIONS} ${writeInLanguage()}`,
        prompt: JSON.stringify(blueprintDocContext(raw, workflowName)),
      },
    };
  }

  get(workflowId: string): Promise<WorkflowDoc | null> {
    return this.prisma.workflowDoc.findUnique({ where: { workflowId } });
  }
}
