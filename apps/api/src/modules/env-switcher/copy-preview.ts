import { EnvName, N8nWorkflow, Replacement, previewDeepReplace, withEnvSuffix } from '@nwm/core';
import { Mapping, switchResources } from './switch-resources';
import { UnmappedResource, findUnmappedResources } from './unmapped-resources';

/** Ressource basculée sur un nœud, avec son nom affiché avant/après. */
export interface SwitchedResource {
  nodeName: string;
  from: string;
  to: string;
}

export interface CopyPreview {
  /** Nom que portera la copie (nom suffixé par l'env cible). */
  targetName: string;
  /** Une copie porte DÉJÀ ce nom sur l'instance : en dupliquer une seconde ferait un doublon. */
  alreadyExists: boolean;
  /** Le workflow EST déjà dans l'env cible : la copie porterait son propre nom. */
  sameAsSource: boolean;
  /** Nombre de valeurs de ressources que les mappings basculeront. */
  replacements: number;
  /** Ressources basculées dont le nom affiché change — un id sans libellé n'y figure pas. */
  switched: SwitchedResource[];
  /** Ressources qu'aucun mapping ne couvre : la copie restera branchée sur celles de la source. */
  unmapped: UnmappedResource[];
}

export interface CopyPreviewContext {
  targetEnv: EnvName;
  envs: EnvName[];
  /** Noms servis aujourd'hui par l'instance — relus de n8n, pas du miroir. */
  existingNames: Set<string>;
  replacements: Replacement[];
  mappings: Mapping[];
}

/** Ce que la duplication d'UN workflow ferait, sans rien écrire — commun au workflow seul et au groupe. */
export function previewCopy(
  workflow: { name: string; raw: N8nWorkflow | null },
  context: CopyPreviewContext,
): CopyPreview {
  const targetName = withEnvSuffix(workflow.name, context.targetEnv, context.envs);
  const raw = workflow.raw;
  return {
    targetName,
    alreadyExists: context.existingNames.has(targetName),
    sameAsSource: targetName === workflow.name,
    replacements: raw ? previewDeepReplace(raw, context.replacements).length : 0,
    switched: raw ? switchResources(raw, context.mappings, context.targetEnv, context.envs).relabeled : [],
    unmapped: raw
      ? findUnmappedResources(
          raw,
          context.mappings.map((mapping) => mapping.values),
        )
      : [],
  };
}
