import { AI_PROVIDERS, AiProvider } from '@nwm/core';
import { DEFAULT_AI_MODEL } from '@nwm/adapter-anthropic';
import { DEFAULT_MISTRAL_MODEL } from '@nwm/adapter-mistral';

export interface AiProviderInfo {
  id: AiProvider;
  /** Nom affiché : l'id est un identifiant, pas un libellé. */
  label: string;
  /** Modèle servi quand aucun n'est saisi — l'UI le montre en indication. */
  defaultModel: string;
  /** Variables d'env consultées à défaut de réglage en DB, pour le dire à l'écran. */
  envKey: string;
}

export const AI_PROVIDER_INFOS: AiProviderInfo[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    defaultModel: DEFAULT_AI_MODEL,
    envKey: 'ANTHROPIC_API_KEY',
  },
  { id: 'mistral', label: 'Mistral', defaultModel: DEFAULT_MISTRAL_MODEL, envKey: 'MISTRAL_API_KEY' },
];

export function aiProviderInfo(provider: AiProvider): AiProviderInfo {
  const info = AI_PROVIDER_INFOS.find((candidate) => candidate.id === provider);
  if (!info) throw new Error(`Unknown AI provider: ${provider}`);
  return info;
}

export { AI_PROVIDERS };
