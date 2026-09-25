/**
 * Noms des credentials n8n après une bascule d'env.
 *
 * Même travers que les resourceLocator, autre forme : un nœud range sa credential
 * en `credentials[type] = { id, name }`, et un remplacement d'id laisse le `name`
 * d'à côté. Le nœud s'authentifie alors en prod sous le nom du compte de dev —
 * un nom faux étant justement celui qu'on lit dans l'éditeur pour décider.
 */
import { DEFAULT_ENV_IDS } from '../env';
import { N8nWorkflow } from './workflow.types';
import { RelabelResult, withEnvMark } from './resource-locator-labels';

/**
 * Remet à jour le `name` des credentials dont l'id vient d'être remplacé.
 * `labels` donne le vrai nom par id cible (mémorisé par le mapping, seul endroit
 * où on l'apprend) ; à défaut on estampille l'env, comme pour les locators.
 */
export function relabelCredentials(
  workflow: N8nWorkflow,
  labels: Map<string, string>,
  env?: string,
  /** Ids effectivement remplacés : eux seuls ont un nom devenu faux. */
  switchedIds?: Set<string>,
  /** Envs déclarés, pour reconnaître (et remplacer) une estampille déjà posée. */
  envs: readonly string[] | undefined = DEFAULT_ENV_IDS,
): RelabelResult {
  const relabeled: RelabelResult['relabeled'] = [];

  const nodes = (workflow.nodes ?? []).map((node) => {
    if (!node.credentials) return node;
    const credentials = Object.fromEntries(
      Object.entries(node.credentials).map(([type, credential]) => {
        const id = credential?.id;
        const current = credential?.name ?? '';
        if (!id || (switchedIds !== undefined && !switchedIds.has(id))) return [type, credential];
        const known = labels.get(id);
        const next = known ?? (env && current ? withEnvMark(current, env, envs) : undefined);
        if (!next || next === current) return [type, credential];
        relabeled.push({ nodeName: node.name, from: current, to: next });
        return [type, { ...credential, name: next }];
      }),
    );
    return { ...node, credentials };
  });

  return { workflow: { ...workflow, nodes }, relabeled };
}
