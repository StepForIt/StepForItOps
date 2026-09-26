/**
 * Le mode d'emploi d'un paquet de nœuds communautaires : son README.
 *
 * Le schéma d'un nœud communautaire est connu (l'instance le sert), pas son
 * usage — à quoi sert chaque opération, comment on s'authentifie, les pièges.
 * n8n ne l'embarque nulle part ; l'auteur l'écrit dans le README du paquet.
 */
export interface PackageReadme {
  packageName: string;
  /** Version que ce README décrit ; absente quand la source ne la dit pas. */
  version?: string;
  /** Markdown brut, tel que l'auteur l'a écrit. */
  content: string;
  source: 'npm' | 'github';
  url?: string;
}

/**
 * Port d'INGESTION : le README est rangé chez nous et l'assistant le lit en
 * base. Contrairement à la doc d'une API tierce (`DocsPort`), celui d'une
 * version publiée ne périme pas — on le relit quand la version installée change.
 */
export interface PackageDocsPort {
  /**
   * README de `version` si la source le garde, sinon celui de la dernière
   * version (et `version` le dit). `null` quand le paquet n'a pas de README.
   */
  readme(packageName: string, version?: string): Promise<PackageReadme | null>;
  /**
   * Texte d'une page désignée par un humain (doc manuelle). Le HTML est ramené
   * à du texte : un portail de doc est surtout de la navigation.
   */
  fetchDocument(url: string): Promise<string>;
}

export const PACKAGE_DOCS_PORT = Symbol('PackageDocsPort');
