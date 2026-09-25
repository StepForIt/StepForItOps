import { DEFAULT_ENVS, EnvDefinition } from '../env';
import { acceptsDeclaredPath, entryUrlPath, hasEntryUrl } from './entry-path';
import { PathHolder } from './webhook-path-conflicts';
import { envWebhookPath } from './webhook-paths';
import { N8nNode, N8nWorkflow } from './workflow.types';

/** Une URL que le workflow promu s'apprête à servir, déjà tenue sur la cible par un autre. */
export interface EntryClash {
  node: string;
  url: string;
  holderId: string;
  holderName: string;
  /** Seul un workflow actif enregistre ses URLs : c'est lui qui empêchera la cible de servir la sienne. */
  holderActive: boolean;
  holderNode: string;
  /** Le path suffixé de l'env du détenteur, qui lui rendrait son autonomie ; null si on ne sait pas le décider. */
  move: string | null;
}

function servedEntries(workflow: N8nWorkflow): Array<{ node: N8nNode; url: string }> {
  return (workflow.nodes ?? []).flatMap((node) => {
    const url = !node.disabled && hasEntryUrl(node) ? entryUrlPath(node) : undefined;
    return url ? [{ node, url }] : [];
  });
}

/**
 * Les URLs du workflow promu que d'autres workflows de l'instance cible tiennent déjà.
 *
 * Le cas type : une dev encore servie par l'uuid nu de son formulaire, promue tout
 * droit vers la prod, qui reçoit justement cet uuid nu. n8n enregistre une URL par
 * (path, méthode) à l'échelle de l'instance : la prod créée ne pourrait pas la servir.
 * Le détenteur se déplace vers le path suffixé de SON env, comme le propose la
 * détection des paths disputés — jamais la cible, dont l'URL est celle qu'on publie.
 */
export function findEntryClashes(
  candidate: N8nWorkflow,
  others: PathHolder[],
  envs: readonly EnvDefinition[] = DEFAULT_ENVS,
): EntryClash[] {
  const clashes: EntryClash[] = [];
  for (const { node, url } of servedEntries(candidate)) {
    for (const holder of others) {
      for (const held of servedEntries(holder.raw)) {
        if (held.url !== url) continue;
        const next =
          holder.env && acceptsDeclaredPath(held.node) ? envWebhookPath(url, holder.env, envs) : null;
        clashes.push({
          node: node.name,
          url,
          holderId: holder.id,
          holderName: holder.name,
          holderActive: holder.active,
          holderNode: held.node.name,
          move: next && next !== url ? next : null,
        });
      }
    }
  }
  return clashes;
}
