import { Inject, Injectable, Logger } from '@nestjs/common';
import { LlmNodeTask } from '@prisma/client';
import {
  AI_PORT,
  AiPort,
  LLM_TASKS,
  LlmNodeRequirement,
  LlmNodeTaskVerdict,
  N8N_API_PORT,
  N8nApiPort,
  asLlmTask,
  asRecord,
  executionRunData,
  promptFingerprint,
  redactSecrets,
  templateIsTelling,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** Un extrait suffit à nommer une tâche ; l'intégralité d'un document sortirait pour rien. */
const SAMPLE_MAX_CHARS = 1200;
/** Exécutions relues au plus pour retrouver un prompt réellement envoyé. */
const SAMPLE_EXECUTIONS = 3;

/**
 * La tâche d'un nœud LLM : traduction, classification, extraction…
 *
 * C'est un jugement sur du langage naturel, donc c'est l'IA qui le porte — mais
 * elle ne rend QU'UNE ÉTIQUETTE d'une liste fermée, et jamais un verdict
 * d'adéquation : elle ne sait pas ce que coûte un modèle, et on ne le lui dit
 * pas. Ce qu'une tâche exige est décidé par une table, ailleurs.
 *
 * Le résultat est stocké par empreinte du GABARIT : deux exécutions ne donnent
 * jamais le même texte, et une empreinte sur l'échantillon reclasserait le nœud
 * chaque nuit pour redire la même étiquette. Une classification corrigée à la
 * main n'est jamais réécrite.
 */
@Injectable()
export class TaskClassifierService {
  private readonly logger = new Logger(TaskClassifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_PORT) private readonly ai: AiPort,
    @Inject(N8N_API_PORT) private readonly n8nApi: N8nApiPort,
  ) {}

  /** Les classifications connues d'un workflow, sous la forme que les règles attendent. */
  async verdicts(workflowId: string): Promise<Record<string, LlmNodeTaskVerdict>> {
    const rows = await this.prisma.llmNodeTask.findMany({ where: { workflowId } });
    return Object.fromEntries(rows.map((row) => [row.nodeName, toVerdict(row)]));
  }

  async setManual(workflowId: string, nodeName: string, task: string): Promise<LlmNodeTask> {
    return this.prisma.llmNodeTask.upsert({
      where: { workflowId_nodeName: { workflowId, nodeName } },
      create: {
        workflowId,
        nodeName,
        promptHash: 'manual',
        task: asLlmTask(task),
        confidence: 1,
        source: 'manual',
      },
      update: { task: asLlmTask(task), confidence: 1, source: 'manual' },
    });
  }

  /**
   * Classe ce qui ne l'est pas encore, ou dont le gabarit a changé. Une ligne
   * `manual` est laissée telle quelle : la correction humaine gagne toujours.
   */
  async classify(
    workflow: { id: string; instanceId: string; externalId: string },
    requirements: LlmNodeRequirement[],
  ): Promise<Record<string, LlmNodeTaskVerdict>> {
    const existing = await this.prisma.llmNodeTask.findMany({ where: { workflowId: workflow.id } });
    const byNode = new Map(existing.map((row) => [row.nodeName, row]));
    if (!(await this.ai.isConfigured())) {
      return Object.fromEntries(existing.map((row) => [row.nodeName, toVerdict(row)]));
    }

    const todo: Array<{ requirement: LlmNodeRequirement; hash: string }> = [];
    for (const requirement of requirements) {
      const known = byNode.get(requirement.nodeName);
      if (known?.source === 'manual') continue;
      const template = requirement.promptTemplate ?? '';
      const hash = promptFingerprint(template);
      if (known && known.promptHash === hash) continue; // rien n'a bougé : rien à repayer.
      todo.push({ requirement, hash });
    }
    if (todo.length === 0) {
      return Object.fromEntries(existing.map((row) => [row.nodeName, toVerdict(row)]));
    }

    // Le texte réellement soumis n'est pas dans le gabarit quand celui-ci n'est
    // fait que d'expressions : il vit dans les exécutions, là où ai-cost va déjà
    // chercher les tokens.
    const needsSample = todo.some(({ requirement }) => !templateIsTelling(requirement.promptTemplate));
    const sampled = needsSample ? await this.samplePrompts(workflow) : new Map<string, string>();

    for (const { requirement, hash } of todo) {
      const text = templateIsTelling(requirement.promptTemplate)
        ? requirement.promptTemplate!
        : (sampled.get(requirement.nodeName) ?? sampled.get(requirement.servesNode ?? '') ?? '');
      if (!text.trim()) continue; // Rien à lire : on ne classe pas plutôt que de deviner.
      const verdict = await this.ask(text);
      if (!verdict) continue;
      await this.prisma.llmNodeTask.upsert({
        where: { workflowId_nodeName: { workflowId: workflow.id, nodeName: requirement.nodeName } },
        create: {
          workflowId: workflow.id,
          nodeName: requirement.nodeName,
          promptHash: hash,
          ...verdict,
          source: 'ai',
        },
        update: { promptHash: hash, ...verdict, source: 'ai' },
      });
    }
    return this.verdicts(workflow.id);
  }

  /** Un appel, une étiquette. `effort: low` : c'est une passe de masse. */
  private async ask(text: string): Promise<{ task: string; confidence: number; evidence: string } | null> {
    const excerpt = String(redactSecrets(text)).slice(0, SAMPLE_MAX_CHARS);
    try {
      const answer = await this.ai.generate({
        effort: 'low',
        maxTokens: 400,
        system:
          "Tu nommes la TÂCHE d'un prompt, rien d'autre. Tu ne juges jamais le modèle employé, tu ne parles jamais de coût. Dans le doute : unknown.",
        prompt: [
          `Étiquettes possibles : ${LLM_TASKS.join(', ')}.`,
          'Prompt :',
          '---',
          excerpt,
          '---',
          'Réponds en JSON : {"task":"…","confidence":0..1,"evidence":"la phrase du prompt qui tranche"}',
        ].join('\n'),
      });
      const start = answer.indexOf('{');
      const end = answer.lastIndexOf('}');
      if (start < 0 || end <= start) return null;
      const parsed = JSON.parse(answer.slice(start, end + 1)) as {
        task?: string;
        confidence?: number;
        evidence?: string;
      };
      return {
        task: asLlmTask(parsed.task),
        confidence: clampConfidence(parsed.confidence),
        evidence: (parsed.evidence ?? '').slice(0, 300),
      };
    } catch (error) {
      this.logger.warn(`Classification de tâche KO : ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Le prompt tel qu'il est PARTI, relu dans quelques exécutions récentes.
   *
   * Ce qu'on lit là est de la donnée de production : il passe par `redactSecrets`
   * et n'est transmis que borné — c'est la contrepartie de le lire du tout.
   */
  private async samplePrompts(workflow: {
    instanceId: string;
    externalId: string;
  }): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    const instance = await this.prisma.instance.findUnique({ where: { id: workflow.instanceId } });
    if (!instance || instance.platform !== 'n8n') return found;
    try {
      const executions = await this.n8nApi.listExecutions(instance, workflow.externalId, SAMPLE_EXECUTIONS, {
        includeData: true,
        status: 'success',
      });
      for (const execution of executions) {
        const runData = executionRunData((execution as { data?: unknown }).data);
        if (!runData) continue;
        for (const [nodeName, runs] of Object.entries(runData)) {
          if (found.has(nodeName) || !Array.isArray(runs)) continue;
          const text = firstPromptText(runs);
          if (text) found.set(nodeName, text.slice(0, SAMPLE_MAX_CHARS));
        }
      }
    } catch (error) {
      // Pas de données d'exécution lisibles : on retombe sur le gabarit, et
      // s'il est muet la classification n'a pas lieu. Elle ne devine pas.
      this.logger.warn(`Prompts non échantillonnés : ${(error as Error).message}`);
    }
    return found;
  }
}

/**
 * Le prompt soumis vit dans l'input du sub-node modèle (`inputOverride`), écrit
 * par le callback de tracing au moment de l'appel — le même endroit d'où
 * `llm-usage.ts` tire le nom du modèle.
 */
function firstPromptText(runs: unknown[]): string | null {
  for (const run of runs) {
    const inputs = asRecord(asRecord(run)?.inputOverride)?.ai_languageModel;
    if (!Array.isArray(inputs)) continue;
    for (const items of inputs) {
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const json = asRecord(asRecord(item)?.json);
        const messages = json?.messages;
        if (Array.isArray(messages) && messages.length > 0) {
          const text = messages
            .map((message) => textOf(message))
            .filter(Boolean)
            .join('\n');
          if (text.trim()) return text;
        }
        if (typeof messages === 'string' && messages.trim()) return messages;
      }
    }
  }
  return null;
}

function textOf(message: unknown): string {
  if (typeof message === 'string') return message;
  const record = asRecord(message);
  const content = record?.content ?? record?.text ?? record?.kwargs;
  if (typeof content === 'string') return content;
  const nested = asRecord(content)?.content;
  return typeof nested === 'string' ? nested : '';
}

function clampConfidence(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

function toVerdict(row: LlmNodeTask): LlmNodeTaskVerdict {
  return {
    task: asLlmTask(row.task),
    confidence: row.confidence,
    evidence: row.evidence,
    source: row.source === 'manual' ? 'manual' : 'ai',
  };
}
