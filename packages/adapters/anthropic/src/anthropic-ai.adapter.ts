import Anthropic from '@anthropic-ai/sdk';
import {
  AiAgentParams,
  AiAgentEvent,
  AiAgentResult,
  AiChatParams,
  AiCredentials,
  AiCredentialsProvider,
  AiEffort,
  AiGenerateParams,
  AiMessage,
  AiPort,
  AiThinkingStep,
  AiToolLoopError,
  AiToolTrace,
} from '@nwm/core';

/**
 * Réglage du raisonnement, postérieur au SDK installé — qui ne connaît encore que
 * l'ancienne forme à budget de jetons, refusée par les modèles courants.
 *
 * `adaptive` : le modèle décide seul de la profondeur ; c'est déjà le mode par
 * défaut. `display` ne change QUE le renvoi : `omitted` (défaut) rend des blocs
 * de pensée vides, `summarized` un résumé lisible. Le raisonnement a lieu et est
 * facturé dans les deux cas — le demander ne coûte que les jetons du résumé.
 */
interface ThinkingConfig {
  type: 'adaptive';
  display?: 'summarized' | 'omitted';
}

/**
 * `output_config` et la forme `adaptive` de `thinking` sont postérieurs à la
 * version du SDK installée : on les ajoute au corps de la requête sans passer par
 * `any` (l'API, elle, connaît ces champs). `thinking` est réécrit et non
 * intersecté — le type du SDK ne décrit que l'ancienne forme.
 */
type MessageBody = Omit<Anthropic.MessageCreateParamsNonStreaming, 'thinking'> & {
  output_config?: { effort: AiEffort };
  thinking?: ThinkingConfig;
};

/**
 * Résumés de raisonnement d'une réponse. Les blocs vides sont écartés : c'est ce
 * que rend le mode par défaut, et une rubrique « raisonnement » vide à l'écran
 * laisse croire que le modèle n'a rien pensé.
 */
function thinkingOf(response: Anthropic.Message): string[] {
  return response.content
    .filter((block): block is Anthropic.ThinkingBlock => block.type === 'thinking')
    .map((block) => block.thinking.trim())
    .filter((text) => text.length > 0);
}

export type { AiCredentialsProvider };

/** Credentials issus des variables d'env ANTHROPIC_*. */
export function envAiCredentials(): AiCredentials | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey ? { apiKey, model: process.env.ANTHROPIC_MODEL } : null;
}

export const DEFAULT_AI_MODEL = 'claude-sonnet-5';

/** Allers-retours d'outils par défaut avant que la boucle rende la main. */
const DEFAULT_MAX_ROUNDS = 6;

/** Adapter IA basé sur le SDK officiel Anthropic. */
export class AnthropicAiAdapter implements AiPort {
  constructor(private readonly credentials: AiCredentialsProvider = async () => envAiCredentials()) {}

  async isConfigured(): Promise<boolean> {
    return (await this.credentials()) !== null;
  }

  async testCredentials(credentials?: AiCredentials): Promise<void> {
    const effective = credentials ?? (await this.credentials());
    if (!effective) {
      throw new Error('Aucune clé API IA : réglages IA ou ANTHROPIC_API_KEY');
    }
    const client = new Anthropic({ apiKey: effective.apiKey });
    await client.messages.create({
      model: effective.model || DEFAULT_AI_MODEL,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
  }

  async generate(params: AiGenerateParams): Promise<string> {
    return this.send({
      system: params.system,
      messages: [{ role: 'user', content: params.prompt }],
      maxTokens: params.maxTokens,
      effort: params.effort,
    });
  }

  async generateJson<T>(params: AiGenerateParams): Promise<T> {
    const text = await this.generate({
      ...params,
      system:
        `${params.system ?? ''}\nRéponds UNIQUEMENT avec un JSON valide, sans markdown ni commentaire.`.trim(),
    });
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    return JSON.parse(cleaned) as T;
  }

  async chat(params: AiChatParams): Promise<string> {
    if (params.messages.length === 0) {
      throw new Error('Conversation vide : au moins un message utilisateur est requis');
    }
    return this.send({
      system: params.system,
      messages: params.messages,
      maxTokens: params.maxTokens,
      effort: params.effort,
    });
  }

  /**
   * Déroule la boucle d'outils : le modèle demande, on exécute, on lui rend le
   * résultat, jusqu'à ce qu'il réponde en texte. La borne `maxRounds` évite la
   * boucle sans fin, et son dépassement est une erreur nommée — jamais une
   * réponse tronquée qui passerait pour une réponse.
   */
  async chatWithTools(params: AiAgentParams): Promise<AiAgentResult> {
    if (params.messages.length === 0) {
      throw new Error('Conversation vide : au moins un message utilisateur est requis');
    }
    const credentials = await this.credentials();
    if (!credentials) {
      throw new Error('AiPort non configuré : renseigner les réglages IA ou ANTHROPIC_API_KEY');
    }
    const client = new Anthropic({ apiKey: credentials.apiKey });
    const tools = new Map(params.tools.map((tool) => [tool.name, tool]));
    const maxRounds = params.maxRounds ?? DEFAULT_MAX_ROUNDS;
    const trace: AiToolTrace[] = [];
    const thinking: AiThinkingStep[] = [];

    const conversation: Anthropic.MessageParam[] = params.messages.map(toMessageParam);

    // L'appelant est prévenu AVANT chaque attente, jamais après : une étape
    // annoncée une fois terminée n'aurait rien à montrer pendant qu'elle dure.
    const notify = (event: AiAgentEvent) => {
      try {
        params.onProgress?.(event);
      } catch {
        // Rien de ce qu'un observateur fait ne doit casser le tour.
      }
    };

    for (let round = 0; round <= maxRounds; round += 1) {
      // L'abandon est relu à chaque tour ET passé à l'appel : sans la relecture,
      // un outil qui vient de rendre la main repartirait pour un appel complet.
      params.signal?.throwIfAborted();
      notify({ type: 'round', round });
      const body: MessageBody = {
        model: credentials.model || DEFAULT_AI_MODEL,
        max_tokens: params.maxTokens ?? 4096,
        ...(params.effort ? { output_config: { effort: params.effort } } : {}),
        ...(params.showThinking ? { thinking: { type: 'adaptive', display: 'summarized' } } : {}),
        ...(params.system ? { system: params.system } : {}),
        tools: params.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.input as Anthropic.Tool.InputSchema,
        })),
        // Au dernier tour, le modèle doit conclure : on lui INTERDIT d'appeler
        // un outil au lieu de retirer les outils. Retirés, l'API refuse la
        // requête — une conversation qui porte déjà des blocs `tool_use` doit
        // continuer à déclarer ses outils —, et le tour entier se perdait sur
        // le dernier appel, après avoir payé tous les autres.
        ...(round === maxRounds ? { tool_choice: { type: 'none' as const } } : {}),
        messages: conversation,
      };
      const response = await client.messages.create(body as Anthropic.MessageCreateParamsNonStreaming, {
        signal: params.signal,
      });
      this.assertUsable(response, body.max_tokens);

      for (const text of thinkingOf(response)) thinking.push({ round, text });

      const text = textOf(response);
      const calls = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );
      if (calls.length === 0) return { text, trace, thinking };

      // Le contenu part ENTIER, blocs de pensée compris et non modifiés : l'API
      // les exige tels quels pour poursuivre un tour qui a réfléchi puis appelé
      // un outil. Les réécrire ou les retirer fait échouer l'appel suivant.
      conversation.push({ role: 'assistant', content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of calls) {
        params.signal?.throwIfAborted();
        const tool = tools.get(call.name);
        const input = (call.input ?? {}) as Record<string, unknown>;
        let output: string;
        let failed = false;
        if (!tool) {
          output = `Outil inconnu : ${call.name}`;
          failed = true;
        } else {
          try {
            notify({ type: 'tool', name: call.name, input });
            output = await tool.run(input);
          } catch (error) {
            // L'échec repart au modèle plutôt que de casser la conversation :
            // un mauvais argument se corrige au tour suivant.
            output = `Erreur : ${(error as Error).message}`;
            failed = true;
          }
        }
        trace.push({ name: call.name, input, result: output, failed });
        notify({ type: 'tool-result', name: call.name, failed });
        results.push({ type: 'tool_result', tool_use_id: call.id, content: output, is_error: failed });
      }
      conversation.push({ role: 'user', content: results });
    }

    // Inatteignable en principe — le dernier tour interdit les outils : le
    // garde-fou reste, et rend ce que la boucle avait déjà fait.
    throw new AiToolLoopError(maxRounds, trace, thinking);
  }

  /** Appel unique au modèle : résout les credentials, envoie la conversation, extrait le texte. */
  private async send(params: {
    system?: string;
    messages: AiMessage[];
    maxTokens?: number;
    effort?: AiEffort;
  }): Promise<string> {
    const credentials = await this.credentials();
    if (!credentials) {
      throw new Error('AiPort non configuré : renseigner les réglages IA ou ANTHROPIC_API_KEY');
    }
    const client = new Anthropic({ apiKey: credentials.apiKey });
    const body: MessageBody = {
      model: credentials.model || DEFAULT_AI_MODEL,
      max_tokens: params.maxTokens ?? 4096,
      ...(params.effort ? { output_config: { effort: params.effort } } : {}),
      ...(params.system ? { system: params.system } : {}),
      messages: params.messages.map(toMessageParam),
    };
    const response = await client.messages.create(body as Anthropic.MessageCreateParamsNonStreaming);
    this.assertUsable(response, body.max_tokens);
    return textOf(response);
  }

  /** Une réponse refusée ou coupée n'est pas une réponse : on nomme la vraie cause. */
  private assertUsable(response: Anthropic.Message, maxTokens: number): void {
    if (response.stop_reason === 'refusal') {
      throw new Error('La requête IA a été refusée par les garde-fous du modèle');
    }
    // Réponse coupée en plein milieu : le JSON serait invalide et l'erreur de
    // parsing ferait croire à un modèle capricieux.
    if (response.stop_reason === 'max_tokens') {
      throw new Error(
        `Réponse IA tronquée : budget de ${maxTokens} tokens atteint (raisonnement compris) — augmenter maxTokens ou baisser l'effort`,
      );
    }
  }
}

/**
 * Un message de la conversation, avec ses images éventuelles. Les images sont
 * posées AVANT le texte : le modèle lit alors la consigne en regardant déjà la
 * capture, au lieu de la découvrir après coup.
 */
function toMessageParam(message: AiMessage): Anthropic.MessageParam {
  const images = message.images ?? [];
  if (images.length === 0) return { role: message.role, content: message.content };
  return {
    role: message.role,
    content: [
      ...images.map((image): Anthropic.ImageBlockParam => ({
        type: 'image',
        source: { type: 'base64', media_type: image.mediaType, data: image.data },
      })),
      { type: 'text', text: message.content },
    ],
  };
}

function textOf(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}
