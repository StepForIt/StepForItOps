/**
 * Le naming des modules d'un scénario Make : ceux qu'on a laissés sans nom, et
 * l'écriture d'un nom.
 *
 * Renommer y est sûr PAR CONSTRUCTION — les expressions désignent un module par
 * son id (`{{2.email}}`), jamais par son libellé —, si bien qu'il n'y a rien à
 * réécrire autour, là où n8n impose de reprendre connexions et expressions
 * (`safe-rename.ts`). Ce qui reste utile, c'est de voir les modules qu'on n'a
 * jamais nommés : sur le canvas, dix « HTTP - Make a request » ne disent rien de
 * ce que fait chacun.
 */
import { CheckFinding } from '../check-finding';
import {
  FlatModule,
  MakeBlueprint,
  MakeModule,
  flattenModules,
  isMakeBlueprint,
  moduleLabel,
} from './blueprint';

export interface ModuleRename {
  moduleId: number;
  newName: string;
}

/** Le libellé posé par l'humain, vide quand Make affiche seulement le type du module. */
function customName(module: MakeModule): string {
  const named = module.metadata?.designer?.name;
  return typeof named === 'string' ? named.trim() : '';
}

/** Les modules que personne n'a nommés. */
export function unnamedModules(blueprint: MakeBlueprint): FlatModule[] {
  return flattenModules(blueprint).filter((flat) => customName(flat.module) === '');
}

/**
 * Les mêmes codes que le naming n8n (`default-name`, `duplicate-nodes`) : un
 * profil de contrôles ou une règle d'exclusion vaut pour les deux plateformes.
 */
export function findMakeNamingIssues(blueprint: unknown): CheckFinding[] {
  if (!isMakeBlueprint(blueprint)) return [];
  const findings: CheckFinding[] = unnamedModules(blueprint).map(({ module }) => ({
    severity: 'warning',
    code: 'default-name',
    message: `Le module #${module.id} (${moduleLabel(module)}) n'a pas de nom : nomme-le d'après ce qu'il fait`,
    nodeName: moduleLabel(module),
    data: { moduleId: module.id },
  }));

  // Un module sans aucune configuration (routeur, gestionnaire d'erreur) n'est
  // pas un doublon : ils sont tous identiques par nature.
  const bySignature = new Map<string, MakeModule[]>();
  for (const { module } of flattenModules(blueprint)) {
    if (isEmpty(module.parameters) && isEmpty(module.mapper)) continue;
    const signature = `${module.module}:${JSON.stringify(module.parameters ?? {})}:${JSON.stringify(module.mapper ?? {})}`;
    bySignature.set(signature, [...(bySignature.get(signature) ?? []), module]);
  }
  for (const modules of bySignature.values()) {
    if (modules.length < 2) continue;
    const names = modules.map((module) => `${moduleLabel(module)} (#${module.id})`);
    findings.push({
      severity: 'info',
      code: 'duplicate-nodes',
      message: `Modules identiques (type + réglages) : ${names.join(', ')} — factorisables ?`,
      data: { names, moduleIds: modules.map((module) => module.id) },
    });
  }
  return findings;
}

/**
 * Pose les noms sur une COPIE du blueprint, routes et gestionnaires compris.
 * Un id inconnu fait tout refuser : le scénario a bougé depuis la proposition,
 * et renommer à moitié laisserait croire que le lot est passé.
 */
export function renameModules(blueprint: unknown, renames: ModuleRename[]): MakeBlueprint {
  if (!isMakeBlueprint(blueprint)) {
    throw new Error("Contenu illisible comme blueprint Make (aucun 'flow') : rien n'est renommé.");
  }
  const copy = structuredClone(blueprint);
  const byId = new Map(flattenModules(copy).map((flat) => [flat.module.id, flat.module]));
  const unknown = renames
    .filter((rename) => !byId.has(rename.moduleId))
    .map((rename) => `#${rename.moduleId}`);
  if (unknown.length > 0) {
    throw new Error(`Modules introuvables dans le scénario : ${unknown.join(', ')}`);
  }
  for (const { moduleId, newName } of renames) {
    const name = newName.trim();
    if (!name) throw new Error(`Nom vide pour le module #${moduleId}`);
    const module = byId.get(moduleId)!;
    module.metadata = { ...module.metadata, designer: { ...module.metadata?.designer, name } };
  }
  return copy;
}

function isEmpty(value: Record<string, unknown> | undefined): boolean {
  return !value || Object.keys(value).length === 0;
}
