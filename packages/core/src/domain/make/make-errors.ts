/**
 * Traduction d'un refus de l'API Make en message lisible.
 *
 * Make répond `{ detail, message, code, suberrors }`. Rendu tel quel, un refus
 * de droits ressort en « Access denied » sans dire ce qui manque ; et deux
 * causes très différentes portent le même 401 :
 *
 * - « Invalid token header. » — le jeton est MALFORMÉ (absent, tronqué, mal
 *   préfixé) ;
 * - « Not authorized. » — le jeton est valide mais il lui manque le droit, OU il
 *   appartient à une AUTRE ZONE. C'est le piège : rien dans la réponse ne dit
 *   qu'on tape sur `eu2` avec un jeton `eu1`, et l'erreur brute envoie chercher
 *   des scopes qui sont pourtant cochés.
 *
 * Constaté sur un compte réel, pas déduit de la documentation.
 */
export interface MakeApiErrorBody {
  detail?: string | string[];
  message?: string;
  code?: string;
  suberrors?: Array<{ message?: string; name?: string }>;
}

export class MakeApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'MakeApiError';
  }
}

export function makeErrorMessage(status: number, body: MakeApiErrorBody | string, zone: string): string {
  if (typeof body === 'string') return body.slice(0, 300);
  const detail = Array.isArray(body.detail) ? body.detail.join(' ; ') : body.detail;
  const subs = (body.suberrors ?? [])
    .map((s) => s.message)
    .filter(Boolean)
    .join(' ; ');
  const base = [detail, body.message].filter(Boolean).join(' — ') || `HTTP ${status}`;

  if (status === 401 && detail === 'Invalid token header.') {
    return `${base}. Le jeton est malformé ou absent.`;
  }
  if (status === 401) {
    return `${base}. Soit le jeton n'a pas le droit demandé, soit il appartient à une autre zone que ${zone} — les deux donnent ce même refus.`;
  }
  if (status === 429) {
    return `${base}. Plafond d'appels de l'organisation atteint.`;
  }
  return subs ? `${base} (${subs})` : base;
}

/**
 * « La plateforme ne connaît plus ce workflow. »
 *
 * Le pendant neutre d'`isN8nNotFound`. Un 404 dit qu'il a disparu ; un 403 chez
 * Make dit « scénario d'une autre organisation », ce qui, vu d'ici, revient au
 * même : ce compte ne le sert plus, et l'estampiller absent vaut mieux que de
 * faire échouer toute la passe. Tout autre refus remonte, parce qu'un jeton
 * expiré ne doit surtout PAS faire marquer le parc entier comme disparu.
 */
export function isPlatformNotFound(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  return status === 404 || status === 403;
}
