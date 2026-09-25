/** Erreur renvoyée par l'API publique n8n, avec son code HTTP. */
export class N8nApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'N8nApiError';
  }
}

/**
 * Vrai si l'appel a reçu un 404. Le test porte sur la propriété `status` et non
 * sur `instanceof` : l'erreur traverse la frontière du package adapter.
 */
export function isN8nNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 404;
}
