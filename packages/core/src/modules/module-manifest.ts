/** Identité et métadonnées d'un module fonctionnel de la plateforme. */
export interface ModuleManifest {
  /** Identifiant unique et stable (clé de ModuleState). */
  id: string;
  name: string;
  description: string;
  /** Un module core n'est pas désactivable (instances, workflows, module-admin). */
  core?: boolean;
}
