/**
 * Ce que l'IA reçoit pour documenter un scénario Make.
 *
 * Un blueprint ne porte pas ses liens à part, comme les `connections` de n8n :
 * l'ordre et l'imbrication les portent. Les donner tels quels demanderait à l'IA
 * de reconstituer le graphe à la lecture d'un arbre, et c'est là qu'elle se
 * trompe — une route lue comme la suite de sa sœur. Les liens partent donc
 * explicites (`makeModuleEdges`), la même lecture que le schéma dessiné à côté.
 */
import { redactSecrets } from '../secret-patterns';
import { isMakeBlueprint, flattenModules, moduleLabel } from './blueprint';
import { makeModuleEdges } from './blueprint-view';

export interface BlueprintDocContext {
  name: string;
  modules: Array<{
    id: number;
    name: string;
    module?: string;
    mapper?: Record<string, unknown>;
    parameters?: Record<string, unknown>;
  }>;
  links: Array<{ from: number; to: number; label?: string }>;
}

/** Les secrets sont masqués : un résumé de documentation n'a jamais besoin d'une valeur de clé. */
export function blueprintDocContext(blueprint: unknown, fallbackName: string): BlueprintDocContext {
  if (!isMakeBlueprint(blueprint)) return { name: fallbackName, modules: [], links: [] };
  return redactSecrets({
    name: typeof blueprint.name === 'string' && blueprint.name.trim() ? blueprint.name : fallbackName,
    modules: flattenModules(blueprint).map(({ module }) => ({
      id: module.id,
      name: moduleLabel(module),
      module: module.module,
      mapper: module.mapper,
      parameters: module.parameters,
    })),
    links: makeModuleEdges(blueprint).map((edge) => ({
      from: edge.fromId,
      to: edge.toId,
      ...(edge.label ? { label: edge.label } : {}),
    })),
  });
}
