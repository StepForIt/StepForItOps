import { EnvName } from '@nwm/core';

/** Un exemplaire déjà connu de la plateforme, situé dans son env et son instance. */
export interface KnownExemplar {
  env: EnvName | null;
  instanceId: string;
  instanceName: string;
  /** Version sémantique portée par cet exemplaire, si elle existe. */
  version: string | null;
  name: string;
}

/** Une étape à franchir avant la cible : où promouvoir, et sous quel env. */
export interface ChainStep {
  env: EnvName;
  instanceId: string;
  instanceName: string;
  /** Vrai quand aucun exemplaire de cet env n'existe : l'étape le créera. */
  creates: boolean;
}

/**
 * Où promouvoir chaque étape intermédiaire d'une chaîne. Un env qui a déjà son
 * exemplaire est repris LÀ où il vit — la preprod peut tenir sur une autre
 * instance que la prod. Sinon l'étape atterrit sur l'instance cible, sous le nom
 * suffixé : c'est le seul endroit qu'on puisse déduire sans le demander.
 *
 * Pure : elle ne décide rien d'autre que la destination de chaque étape.
 */
export function resolveChainSteps(
  steps: EnvName[],
  exemplars: KnownExemplar[],
  fallback: { instanceId: string; instanceName: string },
): ChainStep[] {
  return steps.map((env) => {
    const existing = exemplars.find((exemplar) => exemplar.env === env);
    return {
      env,
      instanceId: existing?.instanceId ?? fallback.instanceId,
      instanceName: existing?.instanceName ?? fallback.instanceName,
      creates: !existing,
    };
  });
}
