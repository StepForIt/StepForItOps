import { msg } from '../../i18n';
import { DEFAULT_ENVS, EnvDefinition, findEnv } from '../env';
import { envWebhookPath } from './webhook-paths';
import { EnvName } from '../env';
import { N8nNode, N8nWorkflow } from './workflow.types';
import { acceptsDeclaredPath, entryUrlPath, hasEntryUrl } from './entry-path';

/** Un workflow tel que la détection a besoin de le connaître. */
export interface PathHolder {
  id: string;
  name: string;
  active: boolean;
  env: EnvName | null;
  raw: N8nWorkflow;
}

export interface PathFix {
  workflowId: string;
  workflowName: string;
  env: EnvName;
  node: string;
  from: string;
  to: string;
  /** Le workflow qui garde le path tel quel, et pour lequel celui-ci est libéré. */
  keeper: string;
}

/** Conflit qu'on ne sait pas trancher : à l'humain de décider. */
export interface PathStandoff {
  path: string;
  workflows: string[];
  reason: string;
}

export interface PathConflictReport {
  fixes: PathFix[];
  standoffs: PathStandoff[];
}

function pathNodes(workflow: N8nWorkflow): Array<{ node: N8nNode; path: string }> {
  return (workflow.nodes ?? []).flatMap((node) => {
    const path = hasEntryUrl(node) ? entryUrlPath(node) : undefined;
    return path ? [{ node, path }] : [];
  });
}

/**
 * Qui garde le path nu, parmi les workflows qui se le disputent : l'exemplaire de
 * l'env qui porte le path canonique d'abord, à défaut celui qui est actif — c'est lui que n8n sert aujourd'hui,
 * donc lui dont l'URL est en circulation. Déplacer celle-là casserait des appelants
 * réels pour arranger une copie.
 */
function pickKeeper(group: PathHolder[], envs: readonly EnvDefinition[]): PathHolder | null {
  const canonical = group.find((w) => findEnv(envs, w.env)?.canonicalWebhookPath);
  return canonical ?? group.find((w) => w.active) ?? null;
}

/**
 * Repère les points d'entrée que plusieurs workflows se partagent et propose, pour
 * chaque copie, le path suffixé qui lui rendrait son autonomie.
 *
 * n8n enregistre un path à l'échelle de l'instance : les autres workflows du groupe
 * ne sont pas seulement inutilisables, les appeler exécute le gardien du path.
 */
export function findPathConflicts(
  workflows: PathHolder[],
  envs: readonly EnvDefinition[] = DEFAULT_ENVS,
): PathConflictReport {
  const byPath = new Map<string, Array<{ holder: PathHolder; node: N8nNode }>>();
  for (const holder of workflows) {
    for (const { node, path } of pathNodes(holder.raw)) {
      const entries = byPath.get(path) ?? [];
      entries.push({ holder, node });
      byPath.set(path, entries);
    }
  }

  const fixes: PathFix[] = [];
  const standoffs: PathStandoff[] = [];
  for (const [path, entries] of byPath) {
    if (entries.length < 2) continue;
    const keeper = pickKeeper(
      entries.map((e) => e.holder),
      envs,
    );
    if (!keeper) {
      standoffs.push({
        path,
        workflows: entries.map((e) => e.holder.name),
        reason: msg('env.pathNoKeeper'),
      });
      continue;
    }
    // Un point d'entrée qui ne sait pas porter de path n'a que son identifiant, que
    // l'éditeur n8n ne laisse pas modifier : rien à proposer d'ici.
    const others = entries.filter((e) => e.holder.id !== keeper.id);
    const idOnly = others.filter((e) => !acceptsDeclaredPath(e.node));
    if (idOnly.length > 0) {
      standoffs.push({
        path,
        workflows: idOnly.map((e) => e.holder.name),
        reason: msg('env.pathIdOnly'),
      });
    }
    // Un formulaire servi par son uuid se suffixe comme un path : `<uuid>-dev`.
    const candidates = others.filter((e) => acceptsDeclaredPath(e.node));
    const proposed = candidates.map((e) => ({
      entry: e,
      to: e.holder.env ? envWebhookPath(path, e.holder.env, envs) : null,
    }));
    const undecidable = proposed.filter((p) => p.to === null || p.to === path);
    if (undecidable.length > 0) {
      standoffs.push({
        path,
        workflows: undecidable.map((p) => p.entry.holder.name),
        reason: msg('env.pathEnvUnknown'),
      });
    }
    // Deux copies du même env retomberaient sur le même path : on ne déplace rien
    // pour recréer le conflit ailleurs.
    const decided = proposed.filter((p) => p.to !== null && p.to !== path);
    const counts = new Map<string, number>();
    for (const p of decided) counts.set(p.to!, (counts.get(p.to!) ?? 0) + 1);
    for (const p of decided) {
      if (counts.get(p.to!)! > 1) {
        standoffs.push({
          path,
          workflows: decided.filter((d) => d.to === p.to).map((d) => d.entry.holder.name),
          reason: msg('env.pathSameTarget', { path: p.to }),
        });
        break;
      }
    }
    for (const p of decided) {
      if (counts.get(p.to!)! > 1) continue;
      fixes.push({
        workflowId: p.entry.holder.id,
        workflowName: p.entry.holder.name,
        env: p.entry.holder.env!,
        node: p.entry.node.name,
        from: path,
        to: p.to!,
        keeper: keeper.name,
      });
    }
  }
  return { fixes, standoffs };
}
