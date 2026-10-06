/**
 * Ce que le journal d'événements (`EventLog`) garde d'un payload.
 *
 * Le journal dit QUE quelque chose s'est passé, et sur quoi : un nom, des ids,
 * un statut. Il n'est relu par aucun module — seule sa date sert (ops-cloud y
 * lit le dernier `instance.synced`). Or `workflow.synced` porte le workflow
 * ENTIER (`raw`), si bien qu'une synchro horaire y recopiait tout le parc :
 * 36 Ko par ligne en moyenne, 900 Mo sur une base de 980, et autant dans
 * chaque snapshot. Une clé dont la valeur dépasse le seuil est remplacée par
 * sa seule taille ; ce qui identifie l'événement reste.
 */

/** Au-delà, une valeur est du contenu et non un identifiant. */
export const EVENT_LOG_VALUE_MAX_BYTES = 1024;

/** Ce qui en tient lieu dans le journal. */
export interface OmittedEventValue {
  omittedBytes: number;
}

export function eventLogPayload(payload: unknown): unknown {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return compactValue(payload);
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    out[key] = compactValue(value);
  }
  return out;
}

function compactValue(value: unknown): unknown {
  if (value === undefined) return null;
  const json = JSON.stringify(value) ?? '';
  const bytes = new TextEncoder().encode(json).length;
  return bytes > EVENT_LOG_VALUE_MAX_BYTES ? ({ omittedBytes: bytes } satisfies OmittedEventValue) : value;
}
