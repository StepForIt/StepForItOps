/**
 * Documentation des systèmes TIERS — Shopify, Stripe, Airtable, NocoDB, Notion —
 * celle que ni n8n ni le parc ne portent.
 *
 * Le catalogue de types de nœuds dit ce que n8n accepte dans un `httpRequest` ;
 * il ne dit rien du nom exact d'une mutation GraphQL, d'un champ de body ou
 * d'une valeur d'énumération de l'API visée. C'est pourtant là que l'assistant
 * écrivait de mémoire : un nom plausible passe tous les contrôles de la
 * plateforme — le graphe tient, le schéma du nœud est respecté — et n'échoue
 * qu'à la première exécution réelle, contre le serveur du tiers.
 */

/** Une bibliothèque/produit tel que la source de doc l'indexe. */
export interface DocsLibrary {
  /** Identifiant à repasser à `readDocs`, opaque (ex. `/shopify/cli`). */
  id: string;
  title: string;
  description?: string;
  /** Indice de fiabilité de la source, quand elle en publie un. */
  trustScore?: number;
  /** Nombre d'extraits indexés : zéro = fiche vide, à ne pas proposer. */
  snippets?: number;
  /** Versions indexées à part, quand il y en a. */
  versions?: string[];
}

/** Un extrait de documentation, tel qu'il est rendu au modèle. */
export interface DocsExcerpt {
  libraryId: string;
  topic?: string;
  /** Markdown, tronqué par la source au budget demandé. */
  content: string;
}

/**
 * Port de lecture de documentation tierce.
 *
 * En LECTURE seule et sans persistance : contrairement au catalogue de nœuds,
 * rien n'est rangé chez nous. Une doc d'API tierce périme — c'est justement ce
 * qu'on vient chercher —, et la garder ferait vieillir la réponse au lieu de
 * la rafraîchir. Le prix est assumé : source injoignable ⇒ l'assistant le DIT
 * et demande, il n'invente pas pour compenser.
 */
export interface DocsPort {
  /** Nom de la source, tel qu'il est cité à l'utilisateur. */
  readonly sourceName: string;
  /** Bibliothèques correspondant à un nom de produit, classées par pertinence. */
  searchLibraries(input: { libraryName: string; query: string }): Promise<DocsLibrary[]>;
  /**
   * Extrait de la documentation d'une bibliothèque, resserré sur `topic`.
   * `null` quand la source ne connaît pas cet identifiant — ce qui n'est pas
   * une panne, et se dit tel quel.
   */
  readDocs(input: { libraryId: string; topic?: string; tokens?: number }): Promise<DocsExcerpt | null>;
}

export const DOCS_PORT = Symbol('DocsPort');
