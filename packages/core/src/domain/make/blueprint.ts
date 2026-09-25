/**
 * Lecture d'un blueprint Make.
 *
 * Le graphe n'a pas la forme de celui de n8n : là où n8n range ses liens dans un
 * `connections` séparé des nœuds, Make IMBRIQUE — les routes d'un routeur dans
 * `routes[]`, les branches d'un If/Else dans `branches[]`, les gestionnaires
 * d'erreur dans `onerror[]`. Tout parcours est donc récursif par nature, et un
 * contrôle qui s'arrêterait au premier niveau ne verrait rien de ce qui compte.
 */

export interface MakeModule {
  id: number;
  /** `namespace:Module`, par exemple `google-sheets:addRow` ou `builtin:BasicRouter`. */
  module?: string;
  version?: number;
  /** Configuration figée : compte, options, `__IMTCONN__`, `feeder` d'un agrégateur. */
  parameters?: Record<string, unknown>;
  /** Valeurs mappées : c'est là que vivent les expressions `{{2.email}}`. */
  mapper?: Record<string, unknown>;
  filter?: MakeFilter | null;
  metadata?: { designer?: { x?: number; y?: number; name?: string } } & Record<string, unknown>;
  /** Routeur : chaque route porte son propre flow. */
  routes?: Array<{ flow?: MakeModule[] }>;
  /** If/Else : chaque branche porte le sien, et ne remonte JAMAIS dans le flow principal. */
  branches?: Array<{ type?: string; merge?: boolean; conditions?: unknown; flow?: MakeModule[] }>;
  /** Gestionnaires d'erreur (Break, Resume, Ignore…). */
  onerror?: MakeModule[];
}

export interface MakeFilter {
  name?: string;
  /** OU de ET : le tableau extérieur est une disjonction. */
  conditions?: Array<Array<{ a?: string; b?: string; o?: string }>>;
}

export interface MakeBlueprint {
  name?: string;
  flow?: MakeModule[];
  metadata?: Record<string, unknown>;
}

/** D'où vient un module dans l'arbre. */
export type ModuleScope = 'main' | 'route' | 'branch' | 'onerror';

export interface FlatModule {
  module: MakeModule;
  scope: ModuleScope;
  /** Le module qui porte la route, la branche ou le gestionnaire. */
  parentId?: number;
  /**
   * Les modules qui ont FORCÉMENT tourné avant celui-ci : ses prédécesseurs dans
   * son propre flow, plus ceux de tous les flows qui l'englobent. C'est ce qui
   * permet de dire qu'une expression vise un module qui n'aura pas tourné —
   * l'équivalent d'`expression-reach.ts` côté n8n, en beaucoup plus simple
   * puisque l'imbrication porte déjà l'information.
   */
  upstreamIds: number[];
}

/** Reconnaît un blueprint, quelle que soit sa provenance (API, fichier collé). */
export function isMakeBlueprint(value: unknown): value is MakeBlueprint {
  const candidate = value as MakeBlueprint | null;
  return Boolean(candidate && typeof candidate === 'object' && Array.isArray(candidate.flow));
}

/**
 * Aplatit l'arbre en gardant, pour chaque module, ce qui a tourné avant lui.
 *
 * Les branches d'un If/Else et les routes d'un routeur sont EXCLUSIVES entre
 * elles : une route ne voit pas ce qui s'est passé dans sa sœur, et c'est
 * exactement ce qui fait qu'une expression y référant est fautive.
 */
export function flattenModules(blueprint: MakeBlueprint): FlatModule[] {
  const flat: FlatModule[] = [];

  const walk = (
    modules: MakeModule[] | undefined,
    scope: ModuleScope,
    parentId: number | undefined,
    inherited: number[],
  ): void => {
    const seen = [...inherited];
    for (const module of modules ?? []) {
      if (!module || typeof module.id !== 'number') continue;
      flat.push({ module, scope, parentId, upstreamIds: [...seen] });
      // Ce qui est imbriqué voit tout ce qui précède SON porteur, le porteur compris.
      const within = [...seen, module.id];
      for (const route of module.routes ?? []) walk(route.flow, 'route', module.id, within);
      for (const branch of module.branches ?? []) walk(branch.flow, 'branch', module.id, within);
      walk(module.onerror, 'onerror', module.id, within);
      seen.push(module.id);
    }
  };

  walk(blueprint.flow, 'main', undefined, []);
  return flat;
}

/**
 * Le nom lisible d'un module. Make range le libellé posé par l'humain dans
 * `metadata.designer.name` ; à défaut, le type dit au moins de quoi il s'agit.
 * Un id nu (« #4 ») ne se montre qu'en dernier recours : il ne veut rien dire
 * pour qui lit un finding.
 */
export function moduleLabel(module: MakeModule): string {
  const named = module.metadata?.designer?.name;
  if (typeof named === 'string' && named.trim()) return named.trim();
  return module.module ?? `#${module.id}`;
}

/** Toutes les chaînes d'un module, là où peuvent vivre expressions et secrets. */
export function moduleStrings(module: MakeModule): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value as object).forEach(walk);
  };
  walk(module.mapper);
  walk(module.parameters);
  walk(module.filter);
  return out;
}
