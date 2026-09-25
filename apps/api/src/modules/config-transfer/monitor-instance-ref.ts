/**
 * Référence à l'instance n8n portée par `Monitor.config.instanceId` (monitors `error-watch`).
 *
 * C'est un uuid local, donc non transposable : à l'export on le traduit en URL d'instance
 * (clé naturelle, comme `workflowRef`), à l'import on le retraduit en uuid de la cible.
 * Sans ça, le monitor importé interroge une instance inexistante et pousse « instance
 * introuvable » — sur la sonde Kuma de la plateforme d'origine, puisque `kumaPushUrl` est
 * lui aussi recopié.
 */

/** Instance visée par la config d'un monitor, si elle en vise une. */
export function monitorInstanceId(config: Record<string, unknown> | null): string | null {
  const instanceId = config?.instanceId;
  return typeof instanceId === 'string' && instanceId.length > 0 ? instanceId : null;
}

/** Même config, avec `instanceId` remplacé par l'id local. */
export function withInstanceId(
  config: Record<string, unknown> | null,
  instanceId: string,
): Record<string, unknown> {
  return { ...(config ?? {}), instanceId };
}
