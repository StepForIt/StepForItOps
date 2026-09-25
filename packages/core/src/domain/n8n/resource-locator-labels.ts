/**
 * Libellés des resourceLocator n8n après une bascule d'env.
 *
 * Un remplacement d'id touche `value` mais laisse `cachedResultName` à côté :
 * le workflow tape la bonne base et en affiche une autre. Un nom faux est pire
 * qu'une absence de nom — c'est celui-là qu'on lit dans l'éditeur pour décider.
 */
import { DEFAULT_ENV_IDS } from '../env';
import { N8nNode, N8nWorkflow } from './workflow.types';

/** Marqueur d'env déjà posé — « CRM (dev) » —, bâti sur les envs déclarés. */
function envMark(envs: readonly string[]): RegExp {
  const ids = [...envs]
    .sort((a, b) => b.length - a.length)
    .map((id) => id.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&'));
  return new RegExp(`\\s*\\((${ids.join('|')})\\)\\s*$`, 'i');
}

/** `{ __rl: true, value, cachedResultName }` — la forme que n8n donne à un choix de ressource. */
function isResourceLocator(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'value' in (value as Record<string, unknown>) &&
    'cachedResultName' in (value as Record<string, unknown>)
  );
}

/**
 * Nom de repli quand le mapping ne connaît pas le vrai titre de la ressource
 * cible : on garde le nom d'origine et on l'estampille de l'env. Faute de
 * mieux, il dit au moins de quel côté on est. Un marqueur précédent est retiré,
 * sinon les bascules successives empilent « CRM (dev) (prod) ».
 */
export function withEnvMark(
  label: string,
  env: string,
  envs: readonly string[] | undefined = DEFAULT_ENV_IDS,
): string {
  return `${label.replace(envMark(envs), '').trim()} (${env})`;
}

export interface RelabelResult {
  workflow: N8nWorkflow;
  /** Un libellé par nœud touché, pour l'afficher dans l'aperçu. */
  relabeled: Array<{ nodeName: string; from: string; to: string }>;
}

/**
 * Remet à jour les `cachedResultName` des ressources dont l'id vient d'être
 * remplacé. `labels` donne le vrai titre par id cible (mémorisé par le mapping) ;
 * les ids absents de cette table retombent sur l'estampille d'env.
 */
export function relabelResourceLocators(
  workflow: N8nWorkflow,
  labels: Map<string, string>,
  /** Env cible, pour le repli. Sans lui, seuls les libellés connus sont posés. */
  env?: string,
  /** Ids effectivement remplacés : eux seuls ont un libellé devenu faux. */
  switchedIds?: Set<string>,
  /** Envs déclarés, pour reconnaître (et remplacer) une estampille déjà posée. */
  envs: readonly string[] | undefined = DEFAULT_ENV_IDS,
): RelabelResult {
  const relabeled: RelabelResult['relabeled'] = [];

  const walk = (value: unknown, node: N8nNode): unknown => {
    if (isResourceLocator(value)) {
      const id = value.value;
      const current = typeof value.cachedResultName === 'string' ? value.cachedResultName : '';
      if (typeof id === 'string' && (switchedIds === undefined || switchedIds.has(id))) {
        const known = labels.get(id);
        const next = known ?? (env && current ? withEnvMark(current, env, envs) : undefined);
        if (next && next !== current) {
          relabeled.push({ nodeName: node.name, from: current, to: next });
          return { ...value, cachedResultName: next };
        }
      }
      return value;
    }
    if (Array.isArray(value)) return value.map((item) => walk(item, node));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, walk(child, node)]),
      );
    }
    return value;
  };

  const nodes = (workflow.nodes ?? []).map((node) => ({
    ...node,
    parameters: walk(node.parameters ?? {}, node) as Record<string, unknown>,
  }));
  return { workflow: { ...workflow, nodes }, relabeled };
}
