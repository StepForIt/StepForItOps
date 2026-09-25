/**
 * Le blueprint d'un scénario, prêt à SORTIR de la plateforme : collé dans une
 * conversation, gardé de côté, ou réimporté dans Make (« Import Blueprint »).
 *
 * Rendu tel que Make l'a servi, sans nettoyage : contrairement au JSON de n8n,
 * il ne porte pas l'identité de l'exemplaire (ni id, ni état actif, ni instance)
 * — c'est déjà ce que Make lui-même produit à l'export. Les connexions n'y sont
 * que des ids, jamais leurs secrets, et c'est l'import qui demande à les
 * rattacher dans le compte d'arrivée.
 */
import { flattenModules, isMakeBlueprint } from './blueprint';

/** Refuse ce qui n'est pas un blueprint : un export illisible passerait pour une sauvegarde. */
export function blueprintExportText(blueprint: unknown): string {
  if (!isMakeBlueprint(blueprint)) {
    throw new Error("Contenu illisible comme blueprint Make (aucun 'flow') : rien à exporter.");
  }
  return JSON.stringify(blueprint, null, 2);
}

/** Tous les modules, routes et gestionnaires d'erreur compris. */
export function blueprintModuleCount(blueprint: unknown): number {
  return isMakeBlueprint(blueprint) ? flattenModules(blueprint).length : 0;
}
