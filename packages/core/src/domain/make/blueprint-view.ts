/**
 * De quoi DESSINER un scénario Make : les liens entre modules, et le Mermaid.
 *
 * Un blueprint ne porte pas ses liens — l'ordre du tableau et l'imbrication les
 * portent à sa place. Ce fichier les rend explicites, une fois, pour que la vue,
 * la carte et la documentation lisent la même chose.
 */
import { msg } from '../../i18n';
import { FlatModule, MakeBlueprint, MakeModule, flattenModules, moduleLabel } from './blueprint';

export interface MakeEdge {
  fromId: number;
  toId: number;
  /** « route 2 », « sinon », « erreur »… vide pour un enchaînement ordinaire. */
  label?: string;
}

/**
 * Les liens d'exécution. Trois formes, et trois seulement :
 * l'enchaînement dans un même flow, l'entrée dans une route ou une branche, et
 * le détour par un gestionnaire d'erreur.
 */
export function makeModuleEdges(blueprint: MakeBlueprint): MakeEdge[] {
  const edges: MakeEdge[] = [];

  const walk = (modules: MakeModule[] | undefined): void => {
    const flow = (modules ?? []).filter((module) => typeof module?.id === 'number');
    flow.forEach((module, index) => {
      const next = flow[index + 1];
      if (next) edges.push({ fromId: module.id, toId: next.id });

      (module.routes ?? []).forEach((route, i) => {
        const first = (route.flow ?? [])[0];
        if (first)
          edges.push({
            fromId: module.id,
            toId: first.id,
            label: msg('platform.makeEdgeRoute', { index: i + 1 }),
          });
        walk(route.flow);
      });

      (module.branches ?? []).forEach((branch, i) => {
        const first = (branch.flow ?? [])[0];
        // Une branche `else` n'a pas de conditions : elle se nomme d'elle-même.
        const label =
          branch.type === 'else'
            ? msg('platform.makeEdgeElse')
            : msg('platform.makeEdgeIf', { index: i + 1 });
        if (first) edges.push({ fromId: module.id, toId: first.id, label });
        walk(branch.flow);
      });

      const handler = (module.onerror ?? [])[0];
      if (handler) edges.push({ fromId: module.id, toId: handler.id, label: 'erreur' });
      walk(module.onerror);
    });
  };

  walk(blueprint.flow);
  return edges;
}

export type MakeFlag = 'error' | 'warning';

/**
 * Le schéma du scénario. Les modules signalés sont entourés, comme côté n8n :
 * un schéma qui ne montre pas OÙ ça casse oblige à faire la correspondance à la
 * main entre une liste de findings et un dessin.
 */
export function makeMermaid(blueprint: MakeBlueprint, flagged: Map<number, MakeFlag> = new Map()): string {
  const modules = flattenModules(blueprint);
  if (modules.length === 0) return `graph TD\n  vide["${escapeLabel(msg('platform.makeScenarioEmpty'))}"]`;

  const lines = ['graph TD'];
  for (const { module } of modules) {
    lines.push(`  m${module.id}["${escapeLabel(moduleLabel(module))}"]`);
  }
  for (const edge of makeModuleEdges(blueprint)) {
    lines.push(
      edge.label
        ? `  m${edge.fromId} -->|${escapeLabel(edge.label)}| m${edge.toId}`
        : `  m${edge.fromId} --> m${edge.toId}`,
    );
  }
  for (const [id, flag] of flagged) {
    lines.push(`  style m${id} stroke:${flag === 'error' ? '#ff4d4f' : '#faad14'},stroke-width:3px`);
  }
  return lines.join('\n');
}

/**
 * Les guillemets et les crochets referment un libellé Mermaid au milieu d'un
 * nom de module — et un nom de module vient de l'utilisateur.
 */
function escapeLabel(label: string): string {
  return label
    .replace(/["[\]{}|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * L'URL du scénario dans l'éditeur Make. La team, et non l'organisation :
 * `https://<zone>/<teamId>/scenarios/<id>/edit`. Sans zone ni team, on ne
 * fabrique pas un lien qui mènerait ailleurs — on n'en donne aucun.
 */
export function makeScenarioUrl(zone: string | null, teamId: string | null, externalId: string): string {
  if (!zone || !teamId) return '';
  return `https://${zone.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/${teamId}/scenarios/${externalId}/edit`;
}

/** Le compte des liens, pour les statistiques de la vue. */
export function makeStats(blueprint: MakeBlueprint): { modules: number; connections: number } {
  return { modules: flattenModules(blueprint).length, connections: makeModuleEdges(blueprint).length };
}

export type { FlatModule };
