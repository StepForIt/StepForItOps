import { BadGatewayException } from '@nestjs/common';
import { ProbeHttpRequest } from '@nwm/core';

/** Refus du provider relayé par la sonde, avec son statut HTTP quand il en a un. */
export class ProbeCallError extends BadGatewayException {
  constructor(
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
  }
}

/** Respond to Webhook peut renvoyer l'objet nu ou un tableau à un seul item. */
export function unwrapItem(body: unknown): unknown {
  return Array.isArray(body) && body.length === 1 ? body[0] : body;
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

/** Le message du provider si on le trouve, son corps brut tronqué sinon. */
export function describeFailure(value: unknown): string {
  const message = field(value, 'message') ?? field(value, 'msg') ?? field(value, 'error');
  if (typeof message === 'string' && message) return message;
  if (typeof value === 'string' && value) return value.slice(0, 300);
  return JSON.stringify(value ?? null).slice(0, 300);
}

/**
 * Corps utile de la réponse, ou erreur lisible. Le nœud HTTP répond en
 * `fullResponse` : c'est nous qui jugeons du statut, et un refus du provider
 * devient une phrase claire au lieu de « Workflow execution failed ».
 */
export function readHttpProbeResponse(body: unknown, request: ProbeHttpRequest): unknown {
  const item = unwrapItem(body);
  const where = `${request.method ?? 'GET'} ${request.url}`;

  const failure = field(item, 'error');
  if (failure !== undefined) {
    throw new ProbeCallError(`${where} a échoué : ${describeFailure(failure)}`);
  }

  const status = field(item, 'statusCode');
  if (typeof status !== 'number') return item;
  if (status >= 200 && status < 300) return field(item, 'body');
  throw new ProbeCallError(`${where} → ${status} : ${describeFailure(field(item, 'body'))}`, status);
}

/** Lignes rendues par un nœud de requête (`allIncomingItems`), ou l'erreur qu'il a laissé passer. */
export function readRowsProbeResponse(body: unknown, what: string): unknown[] {
  const rows = Array.isArray(body) ? body : [body];
  const failure = rows.map((row) => field(row, 'error')).find((error) => error !== undefined);
  if (failure !== undefined) throw new ProbeCallError(`${what} a échoué : ${describeFailure(failure)}`);
  return rows;
}
