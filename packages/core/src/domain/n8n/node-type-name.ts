/**
 * Deux écritures d'un même type de nœud.
 *
 * Le JSON n8n — et donc tout le reste de la plateforme — emploie la forme
 * LONGUE : `n8n-nodes-base.slack`, `@n8n/n8n-nodes-langchain.agent`. Le
 * catalogue mutualisé de n8n-mcp stocke la forme COURTE : `nodes-base.slack`,
 * `nodes-langchain.agent`.
 *
 * Confondre les deux ne casse rien bruyamment : la recherche ne trouve rien, le
 * nœud passe pour inconnu du catalogue, et le contrôle se tait au lieu de crier.
 * La conversion vit donc ici, en un seul endroit, et non chez l'appelant.
 */

const PACKAGE_ALIASES: Array<{ long: string; short: string }> = [
  { long: '@n8n/n8n-nodes-langchain', short: 'nodes-langchain' },
  { long: 'n8n-nodes-base', short: 'nodes-base' },
];

/** `nodes-base.slack` → `n8n-nodes-base.slack`. Toute autre forme est rendue telle quelle. */
export function toLongNodeType(nodeType: string): string {
  for (const alias of PACKAGE_ALIASES) {
    if (nodeType.startsWith(`${alias.long}.`)) return nodeType;
    if (nodeType.startsWith(`${alias.short}.`)) {
      return `${alias.long}.${nodeType.slice(alias.short.length + 1)}`;
    }
  }
  return nodeType;
}

/** `n8n-nodes-base.slack` → `nodes-base.slack`, pour interroger le catalogue amont. */
export function toShortNodeType(nodeType: string): string {
  for (const alias of PACKAGE_ALIASES) {
    if (nodeType.startsWith(`${alias.long}.`)) {
      return `${alias.short}.${nodeType.slice(alias.long.length + 1)}`;
    }
  }
  return nodeType;
}
