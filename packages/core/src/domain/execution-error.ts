/**
 * Extraction du « qu'est-ce qui a fail » depuis le JSON d'une exécution n8n
 * (`GET /executions/:id?includeData=true`). Le format n'est pas contractuel :
 * tout est défensif, un JSON inattendu rend un détail vide plutôt qu'une exception.
 */

export interface ExecutionErrorDetail {
  failedNode?: string;
  failedNodeType?: string;
  message?: string;
  stack?: string;
}

const MAX_MESSAGE = 1000;
const MAX_STACK = 4000;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function truncate(text: string | undefined, max: number): string | undefined {
  if (text === undefined) return undefined;
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** `data` peut arriver en objet ou en chaîne JSON selon la version de n8n. */
function parseData(data: unknown): Record<string, unknown> | undefined {
  if (typeof data === 'string') {
    try {
      return asRecord(JSON.parse(data));
    } catch {
      return undefined;
    }
  }
  return asRecord(data);
}

/** L'objet erreur n8n : message direct + éventuellement le nœud fautif imbriqué. */
function fromErrorObject(error: Record<string, unknown>): ExecutionErrorDetail {
  const node = asRecord(error.node);
  const message = asString(error.message) ?? asString(error.description) ?? asString(error.name);
  return {
    failedNode: asString(node?.name),
    failedNodeType: asString(node?.type),
    message: truncate(message, MAX_MESSAGE),
    stack: truncate(asString(error.stack), MAX_STACK),
  };
}

/** Repli : parcourt runData à la recherche du premier nœud portant une erreur. */
function fromRunData(runData: Record<string, unknown>): ExecutionErrorDetail | undefined {
  for (const [nodeName, runs] of Object.entries(runData)) {
    if (!Array.isArray(runs)) continue;
    for (const run of runs) {
      const error = asRecord(asRecord(run)?.error);
      if (!error) continue;
      const detail = fromErrorObject(error);
      return { ...detail, failedNode: detail.failedNode ?? nodeName };
    }
  }
  return undefined;
}

export function parseExecutionError(execution: { data?: unknown }): ExecutionErrorDetail {
  const data = parseData(execution.data);
  const resultData = asRecord(data?.resultData);
  if (!resultData) return {};

  const lastNode = asString(resultData.lastNodeExecuted);
  const error = asRecord(resultData.error);
  const runData = asRecord(resultData.runData);

  const detail = error ? fromErrorObject(error) : runData ? fromRunData(runData) : undefined;

  if (!detail) return { failedNode: lastNode };
  return { ...detail, failedNode: detail.failedNode ?? lastNode };
}
