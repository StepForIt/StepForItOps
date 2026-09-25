import {
  AiAgentEvent,
  AiAgentParams,
  AiAgentResult,
  AiChatParams,
  AiCredentials,
  AiCredentialsProvider,
  AiGenerateParams,
  AiPort,
  AiToolLoopError,
  AiToolTrace,
} from '@nwm/core';
import { MistralMessage, MistralRequest, MistralToolDef, callMistral, textOfContent } from './mistral-api';
import { parseToolArguments, toMistralConversation } from './mistral-messages';

/** Credentials issus des variables d'env MISTRAL_*. */
export function envMistralCredentials(): AiCredentials | null {
  const apiKey = process.env.MISTRAL_API_KEY;
  return apiKey ? { apiKey, model: process.env.MISTRAL_MODEL } : null;
}

/**
 * Modèle par défaut. `medium` et non `large` : c'est le seul des deux qui lise
 * les images, et le tiroir de chat accepte des captures d'écran.
 */
export const DEFAULT_MISTRAL_MODEL = 'mistral-medium-latest';

/** Allers-retours d'outils par défaut avant que la boucle rende la main. */
const DEFAULT_MAX_ROUNDS = 6;

/**
 * Adapter IA pour Mistral. Deux réglages du port n'ont pas d'équivalent chez ce
 * fournisseur et sont ignorés SANS erreur : `effort` (aucun bouton de profondeur
 * de raisonnement) et `showThinking` (l'API n'expose aucun résumé de
 * raisonnement, donc `thinking` revient toujours vide).
 */
export class MistralAiAdapter implements AiPort {
  constructor(private readonly credentials: AiCredentialsProvider = async () => envMistralCredentials()) {}

  async isConfigured(): Promise<boolean> {
    return (await this.credentials()) !== null;
  }

  async testCredentials(credentials?: AiCredentials): Promise<void> {
    const effective = credentials ?? (await this.credentials());
    if (!effective) {
      throw new Error('Aucune clé API IA : réglages IA ou MISTRAL_API_KEY');
    }
    await callMistral(effective.apiKey, {
      model: effective.model || DEFAULT_MISTRAL_MODEL,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
  }

  async generate(params: AiGenerateParams): Promise<string> {
    return this.send({
      system: params.system,
      messages: [{ role: 'user', content: params.prompt }],
      maxTokens: params.maxTokens,
    });
  }

  async generateJson<T>(params: AiGenerateParams): Promise<T> {
    const text = await this.send({
      system:
        `${params.system ?? ''}\nRéponds UNIQUEMENT avec un JSON valide, sans markdown ni commentaire.`.trim(),
      messages: [{ role: 'user', content: params.prompt }],
      maxTokens: params.maxTokens,
      // Le mode JSON de l'API garantit la forme ; la consigne reste, elle décrit
      // le schéma attendu, que ce mode ne connaît pas.
      json: true,
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
    return this.send({ system: params.system, messages: params.messages, maxTokens: params.maxTokens });
  }

  /**
   * Déroule la boucle d'outils : le modèle demande, on exécute, on lui rend le
   * résultat, jusqu'à ce qu'il réponde en texte.
   */
  async chatWithTools(params: AiAgentParams): Promise<AiAgentResult> {
    if (params.messages.length === 0) {
      throw new Error('Conversation vide : au moins un message utilisateur est requis');
    }
    const credentials = await this.credentials();
    if (!credentials) {
      throw new Error('AiPort non configuré : renseigner les réglages IA ou MISTRAL_API_KEY');
    }
    const tools = new Map(params.tools.map((tool) => [tool.name, tool]));
    const maxRounds = params.maxRounds ?? DEFAULT_MAX_ROUNDS;
    const trace: AiToolTrace[] = [];
    const conversation = toMistralConversation(params.system, params.messages);

    const notify = (event: AiAgentEvent) => {
      try {
        params.onProgress?.(event);
      } catch {
        // Rien de ce qu'un observateur fait ne doit casser le tour.
      }
    };

    const definitions: MistralToolDef[] = params.tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.input },
    }));

    for (let round = 0; round <= maxRounds; round += 1) {
      notify({ type: 'round', round });
      const maxTokens = params.maxTokens ?? 4096;
      const body: MistralRequest = {
        model: credentials.model || DEFAULT_MISTRAL_MODEL,
        max_tokens: maxTokens,
        messages: conversation,
        tools: definitions,
        // Au dernier tour, le modèle doit conclure : on lui INTERDIT d'appeler un
        // outil au lieu de retirer les outils. Retirés, la conversation garde des
        // messages `tool` que l'API n'accepte plus, et le tour entier se perdait
        // sur le dernier appel après avoir payé tous les autres.
        tool_choice: round === maxRounds ? ('none' as const) : ('auto' as const),
      };
      const response = await callMistral(credentials.apiKey, body);
      const choice = response.choices[0];
      if (!choice) throw new Error('Réponse IA vide : aucun choix rendu par Mistral');
      assertUsable(choice.finish_reason, maxTokens);

      const calls = choice.message.tool_calls ?? [];
      const text = textOfContent(choice.message.content);
      if (calls.length === 0) return { text, trace, thinking: [] };

      // L'appel du modèle repart tel quel : l'API apparie chaque résultat à son
      // `tool_call_id`, et un message d'assistant reconstruit ferait échouer le tour.
      conversation.push({
        role: 'assistant',
        content: typeof choice.message.content === 'string' ? choice.message.content : '',
        tool_calls: calls,
      });

      for (const call of calls) {
        const tool = tools.get(call.function.name);
        const input = parseToolArguments(call.function.arguments);
        let output: string;
        let failed = false;
        if (!tool) {
          output = `Outil inconnu : ${call.function.name}`;
          failed = true;
        } else {
          try {
            notify({ type: 'tool', name: call.function.name, input });
            output = await tool.run(input);
          } catch (error) {
            // L'échec repart au modèle plutôt que de casser la conversation.
            output = `Erreur : ${(error as Error).message}`;
            failed = true;
          }
        }
        trace.push({ name: call.function.name, input, result: output, failed });
        notify({ type: 'tool-result', name: call.function.name, failed });
        conversation.push({ role: 'tool', tool_call_id: call.id, content: output });
      }
    }

    // Inatteignable en principe — le dernier tour interdit les outils : le
    // garde-fou reste, et rend ce que la boucle avait déjà fait.
    throw new AiToolLoopError(maxRounds, trace, []);
  }

  /** Appel unique au modèle : résout les credentials, envoie la conversation, extrait le texte. */
  private async send(params: {
    system?: string;
    messages: AiChatParams['messages'];
    maxTokens?: number;
    json?: boolean;
  }): Promise<string> {
    const credentials = await this.credentials();
    if (!credentials) {
      throw new Error('AiPort non configuré : renseigner les réglages IA ou MISTRAL_API_KEY');
    }
    const maxTokens = params.maxTokens ?? 4096;
    const messages: MistralMessage[] = toMistralConversation(params.system, params.messages);
    const response = await callMistral(credentials.apiKey, {
      model: credentials.model || DEFAULT_MISTRAL_MODEL,
      max_tokens: maxTokens,
      messages,
      ...(params.json ? { response_format: { type: 'json_object' as const } } : {}),
    });
    const choice = response.choices[0];
    if (!choice) throw new Error('Réponse IA vide : aucun choix rendu par Mistral');
    assertUsable(choice.finish_reason, maxTokens);
    return textOfContent(choice.message.content);
  }
}

/**
 * Une réponse coupée n'est pas une réponse : le JSON serait invalide et l'erreur
 * de parsing ferait croire à un modèle capricieux. `model_length` est la même
 * coupure, atteinte sur la fenêtre du modèle plutôt que sur le budget demandé.
 */
function assertUsable(finishReason: string | undefined, maxTokens: number): void {
  if (finishReason === 'length' || finishReason === 'model_length') {
    throw new Error(
      `Réponse IA tronquée : budget de ${maxTokens} tokens atteint — augmenter maxTokens ou raccourcir le contexte`,
    );
  }
}
