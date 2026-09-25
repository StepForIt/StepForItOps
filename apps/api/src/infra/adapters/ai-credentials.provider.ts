import { AiCredentials, AiCredentialsProvider, AiProvider, isAiProvider } from '@nwm/core';
import { envAiCredentials } from '@nwm/adapter-anthropic';
import { envMistralCredentials } from '@nwm/adapter-mistral';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Fournisseur servi quand rien n'est déclaré en DB : celui d'avant le choix, pour
 * qu'une installation existante ne change pas de modèle en se mettant à jour.
 */
export const DEFAULT_AI_PROVIDER: AiProvider = 'anthropic';

/** Credentials d'env du fournisseur, quand la DB n'en porte pas. */
function envCredentials(provider: AiProvider): AiCredentials | null {
  return provider === 'mistral' ? envMistralCredentials() : envAiCredentials();
}

/**
 * Le fournisseur qui sert les appels. Aucune ligne active — installation neuve,
 * ou clé posée en variable d'env seule — vaut le fournisseur par défaut.
 */
export async function activeAiProvider(prisma: PrismaService): Promise<AiProvider> {
  const active = await prisma.aiSettings.findFirst({ where: { active: true } });
  return active && isAiProvider(active.id) ? active.id : DEFAULT_AI_PROVIDER;
}

/** Résolution des credentials d'UN fournisseur : réglages en DB d'abord, variables d'env sinon. */
export function aiCredentialsProvider(prisma: PrismaService, provider: AiProvider): AiCredentialsProvider {
  return async () => {
    const settings = await prisma.aiSettings.findUnique({ where: { id: provider } });
    if (settings?.apiKey) {
      return { apiKey: settings.apiKey, model: settings.model ?? undefined, provider };
    }
    return envCredentials(provider);
  };
}

/** D'où viennent les credentials effectifs d'un fournisseur, pour le dire à l'écran. */
export async function aiCredentialsSource(
  prisma: PrismaService,
  provider: AiProvider,
): Promise<'db' | 'env' | 'none'> {
  const settings = await prisma.aiSettings.findUnique({ where: { id: provider } });
  if (settings?.apiKey) return 'db';
  return envCredentials(provider) ? 'env' : 'none';
}
