/**
 * Extraction des noms de nœuds référencés dans les expressions n8n :
 *   $node["Name"] / $node['Name']
 *   $('Name') / $("Name")
 *   $items("Name")
 */

const PATTERNS = [
  /\$node\[\s*["']([^"']+)["']\s*\]/g,
  /\$\(\s*["']([^"']+)["']\s*\)/g,
  /\$items\(\s*["']([^"']+)["']\s*\)/g,
];

export function extractNodeRefsFromString(value: string): string[] {
  const refs = new Set<string>();
  for (const pattern of PATTERNS) {
    for (const match of value.matchAll(pattern)) refs.add(match[1]);
  }
  return [...refs];
}

/** Parcourt récursivement un objet JSON et collecte les refs de nœuds par chemin. */
export function extractNodeRefs(value: unknown, path = '$'): Array<{ path: string; ref: string }> {
  const found: Array<{ path: string; ref: string }> = [];
  if (typeof value === 'string') {
    for (const ref of extractNodeRefsFromString(value)) found.push({ path, ref });
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => found.push(...extractNodeRefs(item, `${path}[${i}]`)));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      found.push(...extractNodeRefs(child, `${path}.${key}`));
    }
  }
  return found;
}

/** Remplace les références à `oldName` par `newName` dans toutes les formes d'expressions. */
export function renameNodeRefsInString(value: string, oldName: string, newName: string): string {
  const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value
    .replace(new RegExp(`(\\$node\\[\\s*["'])${escaped}(["']\\s*\\])`, 'g'), `$1${newName}$2`)
    .replace(new RegExp(`(\\$\\(\\s*["'])${escaped}(["']\\s*\\))`, 'g'), `$1${newName}$2`)
    .replace(new RegExp(`(\\$items\\(\\s*["'])${escaped}(["']\\s*\\))`, 'g'), `$1${newName}$2`);
}
