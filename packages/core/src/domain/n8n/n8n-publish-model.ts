/**
 * Les n8n 2.x séparent le BROUILLON de la version PUBLIÉE : « Enregistrer » garde
 * l'édition de côté, « Publier » la met en production, et `activeVersionId` désigne
 * la version publiée. Sur ces instances, « activer » s'appelle publier —
 * `POST /workflows/:id/activate` est déprécié au profit de `/publish`.
 *
 * Ce que ça change pour nous, et c'est plus étroit qu'il n'y paraît :
 *
 * - workflow PUBLIÉ : `PUT /workflows/:id` **republie tout seul** (le paramètre
 *   `publishIfActive` vaut `true` par défaut). L'écriture part en production,
 *   exactement comme sur un n8n 1.x. Rien de particulier à faire.
 * - workflow NON publié : le PUT enregistre un brouillon, et il n'y a rien à
 *   republier. Le workflow ne tournera pas tant qu'un humain n'aura pas publié —
 *   ce qui est le comportement voulu, mais doit être DIT : sans ça on annonce
 *   « appliqué » pour quelque chose qui ne s'exécutera jamais.
 *
 * Publier de notre propre chef un workflow qui ne l'était pas le mettrait en
 * production sans que personne l'ait demandé : ça reste un geste explicite.
 */

import { N8nWorkflow } from './workflow.types';

export type PublishModel =
  /** n8n d'avant la publication par versions : le PUT est l'état du workflow, point. */
  | 'direct'
  /** Publication par versions, workflow publié : le PUT republie de lui-même. */
  | 'versioned-published'
  /** Publication par versions, jamais publié : le PUT n'écrit qu'un brouillon. */
  | 'versioned-unpublished';

/**
 * Lu sur le workflow tel que n8n l'a rendu — jamais sur notre copie locale, qui
 * ne conserve que ce que le domaine connaît. La présence de la clé classe
 * l'instance ; sa valeur dit où en est ce workflow-là.
 */
export function detectPublishModel(raw: N8nWorkflow): PublishModel {
  if (!('activeVersionId' in raw)) return 'direct';
  return raw.activeVersionId ? 'versioned-published' : 'versioned-unpublished';
}

/**
 * Ce que l'écriture produira réellement, à dire à l'humain AVANT qu'il clique.
 * `undefined` quand il n'y a rien de particulier à signaler.
 */
export function describeWriteEffect(model: PublishModel, workflowName: string): string | undefined {
  if (model !== 'versioned-unpublished') return undefined;
  return (
    `« ${workflowName} » n'a jamais été publié sur cette instance. La modification sera ` +
    `enregistrée comme brouillon : elle ne s'exécutera pas tant que le workflow n'est pas publié. ` +
    `Tu pourras le faire d'ici une fois le diff appliqué.`
  );
}

/** Le workflow tourne-t-il vraiment le contenu qu'on vient d'écrire ? */
export function writeIsLive(model: PublishModel): boolean {
  return model !== 'versioned-unpublished';
}

/** Le workflow tourne-t-il en production ? Publié sur un n8n à versions, actif sur les autres. */
export function isPublished(raw: N8nWorkflow): boolean {
  return detectPublishModel(raw) === 'direct' ? raw.active === true : Boolean(raw.activeVersionId);
}
