import { AiMessage } from '@nwm/core';
import { MistralMessage } from './mistral-api';

/**
 * Un message de la conversation, avec ses images éventuelles. Comme chez
 * Anthropic, les images passent AVANT le texte : le modèle lit la consigne en
 * regardant déjà la capture.
 */
export function toMistralMessage(message: AiMessage): MistralMessage {
  const images = message.images ?? [];
  if (images.length === 0) return { role: message.role, content: message.content };
  return {
    role: message.role,
    content: [
      // Mistral ne prend pas de base64 nu : l'image se passe en data URI.
      ...images.map((image) => ({
        type: 'image_url' as const,
        image_url: `data:${image.mediaType};base64,${image.data}`,
      })),
      { type: 'text' as const, text: message.content },
    ],
  };
}

/** Conversation complète, précédée du message système quand il y en a un. */
export function toMistralConversation(system: string | undefined, messages: AiMessage[]): MistralMessage[] {
  const converted = messages.map(toMistralMessage);
  return system ? [{ role: 'system', content: system }, ...converted] : converted;
}

/**
 * Les arguments d'un appel d'outil, rendus par l'API sous forme de chaîne JSON.
 * Une chaîne illisible devient un objet vide : l'outil dira lui-même ce qui
 * manque, là où une exception casserait la conversation entière.
 */
export function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
