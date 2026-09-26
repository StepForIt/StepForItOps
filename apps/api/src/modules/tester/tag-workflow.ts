import { Logger } from '@nestjs/common';
import { N8nApiPort, N8nInstanceConfig } from '@nwm/core';

/**
 * Étiquette un workflow de travail posé par le module (banc, bouchon, copie de
 * test) : c'est le tag qui le sort ensuite des listes et des analyses.
 *
 * L'API publique n8n ne pose pas les tags à la création, d'où ce second appel.
 * Best-effort : son échec ne doit pas perdre l'essai — un tag manquant ne coûte
 * que du bruit dans les listes, et le préfixe du nom reste, lui, toujours là.
 */
export async function tagWorkflow(
  n8n: N8nApiPort,
  config: N8nInstanceConfig,
  externalId: string,
  name: string,
  logger: Logger,
): Promise<void> {
  try {
    const tags = await n8n.listTags(config);
    const tag = tags.find((t) => t.name === name) ?? (await n8n.createTag(config, name));
    await n8n.setWorkflowTags(config, externalId, [tag.id]);
  } catch (error) {
    logger.warn(`Tag ${name} not set on ${externalId}: ${(error as Error).message}`);
  }
}
