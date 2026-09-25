/**
 * JSON à clés ordonnées : deux objets au même contenu donnent la même chaîne.
 *
 * Neutre par nature — c'est une propriété du JSON, pas d'une plateforme — et
 * c'est ce qui permet de comparer un contenu à lui-même d'une passe à l'autre,
 * qu'il s'agisse d'un workflow n8n ou d'un blueprint Make.
 */
import { createHash } from 'crypto';

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortValue(v)]),
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

/**
 * Empreinte d'un contenu quelconque.
 *
 * `hashWorkflow` (n8n) fait mieux quand il le peut : il ÉCARTE ce qui n'est pas
 * significatif, de sorte qu'un `updatedAt` qui bouge ne passe pas pour une
 * modification. Ici on n'a pas cette connaissance — on hache tout ce qui est
 * rendu. Le prix est une fausse modification si la plateforme fait varier un
 * champ de service dans le contenu ; le prix inverse, manquer une vraie
 * modification, serait bien plus cher.
 */
export function hashContent(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}
