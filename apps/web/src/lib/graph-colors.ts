/**
 * Couleur de trait tirée d'un hachage de la clé : un même workflow garde sa couleur d'un rendu,
 * d'un filtre et d'une page à l'autre. Bornes étroites (saturation franche, luminosité basse)
 * pour rester lisible sur fond blanc.
 */

/** Hachage FNV-1a 32 bits : deux ids voisins ne donnent pas deux teintes voisines. */
function hash32(key: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** HSL → hex : mermaid coupe les `linkStyle` aux virgules, un `hsl(…)` y serait éclaté. */
function hslToHex(h: number, s: number, l: number): string {
  const chroma = ((1 - Math.abs(2 * (l / 100) - 1)) * s) / 100;
  const secondary = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const match = l / 100 - chroma / 2;
  const [r, g, b] = (
    h < 60
      ? [chroma, secondary, 0]
      : h < 120
        ? [secondary, chroma, 0]
        : h < 180
          ? [0, chroma, secondary]
          : h < 240
            ? [0, secondary, chroma]
            : h < 300
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary]
  ).map((channel) => Math.round((channel + match) * 255));
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

/** Couleur stable associée à une clé (id de workflow, clé de ressource…). */
export function keyColor(key: string): string {
  const hash = hash32(key);
  // Trois tranches de bits indépendantes : deux clés de teinte proche se séparent quand même
  // par la saturation ou la luminosité.
  return hslToHex(hash % 360, 58 + ((hash >>> 9) % 24), 34 + ((hash >>> 17) % 16));
}
