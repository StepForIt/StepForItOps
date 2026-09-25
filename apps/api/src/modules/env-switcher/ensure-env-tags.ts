import { N8nApiPort, N8nInstanceConfig } from '@nwm/core';

/**
 * Pose sur un workflow n8n les tags d'origine (hors env:*) + `env:<targetEnv>`,
 * en créant côté n8n ceux qui n'existent pas encore. Best-effort : l'appelant
 * décide si un échec de tags doit être bloquant (en général non).
 */
export async function ensureEnvTags(
  n8n: N8nApiPort,
  config: N8nInstanceConfig,
  externalId: string,
  baseTags: string[],
  targetEnv: string,
): Promise<void> {
  const wanted = [...baseTags.filter((t) => !t.toLowerCase().startsWith('env:')), `env:${targetEnv}`];
  const existing = await n8n.listTags(config);
  const tagIds: string[] = [];
  for (const name of wanted) {
    const found = existing.find((t) => t.name === name);
    tagIds.push(found ? found.id : (await n8n.createTag(config, name)).id);
  }
  await n8n.setWorkflowTags(config, externalId, tagIds);
}
