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

/**
 * Le paquet npm d'un type de nœud : tout ce qui précède le DERNIER point
 * (`@scope/n8n-nodes-foo.bar` → `@scope/n8n-nodes-foo`). Le nom d'un nœud n'a
 * jamais de point, celui d'un paquet peut en avoir.
 */
export function nodePackageOf(nodeType: string): string | null {
  const dot = nodeType.lastIndexOf('.');
  return dot > 0 ? nodeType.slice(0, dot) : null;
}

/** Faux pour les deux paquets livrés avec n8n, dont le catalogue mutualisé porte déjà la doc. */
export function isCommunityNodeType(nodeType: string): boolean {
  const pkg = nodePackageOf(nodeType);
  return pkg !== null && !PACKAGE_ALIASES.some((alias) => alias.long === pkg);
}

/** Les paquets communautaires d'un workflow, chacun avec les types qu'il y sert. */
export function communityPackagesOf(workflow: {
  nodes?: Array<{ type: string }>;
}): Array<{ packageName: string; nodeTypes: string[] }> {
  const byPackage = new Map<string, Set<string>>();
  for (const node of workflow.nodes ?? []) {
    if (!isCommunityNodeType(node.type)) continue;
    const pkg = nodePackageOf(node.type) as string;
    byPackage.set(pkg, (byPackage.get(pkg) ?? new Set()).add(node.type));
  }
  return [...byPackage].map(([packageName, types]) => ({ packageName, nodeTypes: [...types] }));
}
