import { ModelCatalogEntry } from '../domain/model-catalog';

/**
 * Port d'accès à une source DÉCLARATIVE de tarifs et de capacités de modèles.
 *
 * Il n'existe que pour le RAFRAÎCHISSEMENT : une fois les lignes en base, plus
 * personne ne le rappelle — c'est la raison d'être du catalogue local et non un
 * cache. L'amont peut disparaître, la plateforme continue de juger.
 *
 * `revision()` sert à ne rien télécharger tant que la source n'a pas bougé,
 * comme pour le catalogue de nœuds.
 */
export interface ModelPricingPort {
  /** Identifiant opaque de la version amont (sha de blob, tag de release…). */
  revision(): Promise<string>;
  /** Ce que la source déclare, traduit dans notre vocabulaire. */
  fetchModels(): Promise<ModelCatalogEntry[]>;
}

export const MODEL_PRICING_PORT = Symbol('ModelPricingPort');
