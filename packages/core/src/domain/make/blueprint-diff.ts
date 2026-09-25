/**
 * Ce qui change entre deux blueprints Make — l'écran de confirmation d'une
 * restauration, et rien de plus.
 *
 * Les modules s'apparient par leur `id` et non par leur nom : Make ne garantit
 * pas l'unicité des libellés, là où l'id est stable dans la vie d'un scénario.
 */
import { FlatModule, MakeModule, flattenModules, isMakeBlueprint, moduleLabel } from './blueprint';

/** Une ressource du compte Make citée par un module : connexion, webhook… */
export interface BlueprintAccountRef {
  /** La clé telle qu'écrite dans `parameters`, ex. `__IMTCONN__`. */
  key: string;
  id: string;
  module: string;
}

export interface BlueprintDiff {
  modules: { current: number; restored: number; added: string[]; removed: string[]; modified: string[] };
  /** L'enchaînement a bougé : ordre, route ou branche d'un module. */
  structureChanged: boolean;
  /** Les réglages du scénario (`metadata`) ont bougé. */
  settingsChanged: boolean;
  /**
   * Ressources citées par la version restaurée et plus par le contenu actuel.
   * Rien ne dit qu'elles ont disparu du compte — mais si c'est le cas, Make
   * remettra le scénario en invalide et refusera de l'activer.
   */
  refsOnlyInRestored: BlueprintAccountRef[];
}

/** Les clés `__IMTCONN__`, `__IMTHOOK__`… que Make pose pour lier un module au compte. */
const ACCOUNT_REF_KEY = /^__IMT[A-Z]+__$/;

export function diffBlueprints(current: unknown, restored: unknown): BlueprintDiff {
  const before = modulesOf(current);
  const after = modulesOf(restored);
  const beforeById = new Map(before.map((flat) => [flat.module.id, flat]));
  const afterById = new Map(after.map((flat) => [flat.module.id, flat]));

  const added = after.filter((flat) => !beforeById.has(flat.module.id)).map(labelOf);
  const removed = before.filter((flat) => !afterById.has(flat.module.id)).map(labelOf);
  const modified = after
    .filter((flat) => {
      const previous = beforeById.get(flat.module.id);
      return previous !== undefined && ownContent(previous.module) !== ownContent(flat.module);
    })
    .map(labelOf);

  const currentRefs = new Set(accountRefs(before).map(refKey));
  return {
    modules: { current: before.length, restored: after.length, added, removed, modified },
    structureChanged: shape(before) !== shape(after),
    settingsChanged: JSON.stringify(metadataOf(current)) !== JSON.stringify(metadataOf(restored)),
    refsOnlyInRestored: dedupe(accountRefs(after).filter((ref) => !currentRefs.has(refKey(ref)))),
  };
}

function modulesOf(raw: unknown): FlatModule[] {
  return isMakeBlueprint(raw) ? flattenModules(raw) : [];
}

function metadataOf(raw: unknown): unknown {
  return isMakeBlueprint(raw) ? (raw.metadata ?? {}) : {};
}

function labelOf(flat: FlatModule): string {
  return moduleLabel(flat.module);
}

/**
 * Le module SANS ce qu'il porte : un routeur dont une route a changé n'est pas
 * modifié lui-même, et le compter ferait remonter chaque porteur jusqu'à la racine.
 */
function ownContent(module: MakeModule): string {
  const { routes: _routes, branches, onerror: _onerror, ...own } = module;
  const branchShells = branches?.map(({ flow: _flow, ...shell }) => shell);
  return JSON.stringify(branchShells ? { ...own, branches: branchShells } : own);
}

/** Qui suit qui, et sous quel porteur : l'équivalent des `connections` de n8n. */
function shape(modules: FlatModule[]): string {
  return modules.map((flat) => `${flat.module.id}:${flat.scope}:${flat.parentId ?? ''}`).join('|');
}

function accountRefs(modules: FlatModule[]): BlueprintAccountRef[] {
  return modules.flatMap((flat) =>
    Object.entries(flat.module.parameters ?? {})
      .filter(
        ([key, value]) =>
          ACCOUNT_REF_KEY.test(key) && (typeof value === 'number' || typeof value === 'string'),
      )
      .map(([key, value]) => ({ key, id: String(value), module: labelOf(flat) })),
  );
}

function refKey(ref: BlueprintAccountRef): string {
  return `${ref.key}#${ref.id}`;
}

function dedupe(refs: BlueprintAccountRef[]): BlueprintAccountRef[] {
  return [...new Map(refs.map((ref) => [refKey(ref), ref])).values()];
}
