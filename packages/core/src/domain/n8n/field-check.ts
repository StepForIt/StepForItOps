/**
 * Confrontation « ce que le workflow lit » ↔ « ce que les exécutions ont réellement produit ».
 *
 * Cas visé : `$('Sales').item.json.salesFistName` alors que le nœud sort
 * `salesFirstName` — invisible à l'analyse statique (le champ vient d'un nœud
 * amont), mais évident dès qu'on regarde les échantillons d'exécution.
 */

import { NodeSamples } from './execution-samples';
import { FieldRef } from './expression-fields';
import { msg } from '../../i18n/translate';

export interface FieldFinding {
  severity: 'info' | 'warning' | 'error';
  /** `field-typo` : un champ très proche existe ; `field-unknown` : jamais vu. */
  code: 'field-typo' | 'field-unknown';
  message: string;
  nodeName: string;
  data: Record<string, unknown>;
}

export interface FieldCheckOptions {
  /** Items minimum échantillonnés sur le nœud source pour oser conclure. */
  minItems?: number;
  /** Longueur minimale d'un chemin pour chercher une faute de frappe. */
  minLengthForSuggestion?: number;
}

const DEFAULTS = { minItems: 1, minLengthForSuggestion: 4 };

function levenshtein(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = current;
    }
  }
  return previous[b.length];
}

/** Tolérance : 1 faute jusqu'à 11 caractères, 2 au-delà, 3 pour les noms très longs. */
function maxDistance(path: string): number {
  return Math.min(3, Math.max(1, Math.floor(path.length / 6)));
}

/**
 * Champ observé le plus proche, à profondeur égale (`a.b` n'est comparé qu'à des
 * chemins à deux segments). Une différence de casse seule est toujours retenue.
 */
export function closestField(path: string, fields: string[]): string | undefined {
  const depth = path.split('.').length;
  const candidates = fields.filter((field) => field.split('.').length === depth);
  const sameLetters = candidates.find((field) => field.toLowerCase() === path.toLowerCase());
  if (sameLetters) return sameLetters;
  if (path.length < DEFAULTS.minLengthForSuggestion) return undefined;

  let best: { field: string; distance: number } | undefined;
  for (const field of candidates) {
    const distance = levenshtein(path.toLowerCase(), field.toLowerCase());
    if (!best || distance < best.distance) best = { field, distance };
  }
  return best && best.distance <= maxDistance(path) ? best.field : undefined;
}

/**
 * Findings pour les champs référencés jamais observés en sortie du nœud source.
 * Un nœud source sans échantillon (jamais exécuté sur la période) n'est pas jugé.
 */
export function checkFieldRefs(
  refs: FieldRef[],
  samples: NodeSamples[],
  options: FieldCheckOptions = {},
): FieldFinding[] {
  const settings = { ...DEFAULTS, ...options };
  const byNode = new Map(samples.map((sample) => [sample.node, sample]));
  const findings: FieldFinding[] = [];

  for (const ref of refs) {
    const sample = byNode.get(ref.source);
    if (!sample || sample.items < settings.minItems) continue;
    if (sample.fields.includes(ref.path)) continue;
    // Un parent du chemin observé mais non détaillé (profondeur d'aplatissement) : on ne conclut pas
    const truncated = sample.fields.some((field) => ref.path.startsWith(`${field}.`));
    if (truncated) continue;

    const suggestion = closestField(ref.path, sample.fields);
    const origin = msg('checks.fieldOrigin', {
      source: ref.source,
      items: sample.items,
      executions: sample.executions,
    });
    findings.push({
      severity: suggestion ? 'error' : 'warning',
      code: suggestion ? 'field-typo' : 'field-unknown',
      message: suggestion
        ? msg('checks.fieldTypo', { path: ref.path, origin, suggestion })
        : msg('checks.fieldUnknown', { path: ref.path, origin }),
      nodeName: ref.node,
      data: {
        source: ref.source,
        path: ref.path,
        at: ref.at,
        suggestion,
        observedFields: sample.fields.slice(0, 50),
        sampledItems: sample.items,
        sampledExecutions: sample.executions,
      },
    });
  }
  return findings;
}
