import {
  MakeApiError,
  MakeApiErrorBody,
  PlatformInstanceConfig,
  RateBudget,
  makeErrorMessage,
} from '@nwm/core';

/**
 * L'accès HTTP à l'API Make v2 : la zone, le jeton, le plafond d'appels.
 *
 * Trois choses que n8n n'impose pas et qui vivent donc ici, une fois pour toutes,
 * plutôt que dans chaque appel de l'adapter.
 */

/** 30/min est le plancher (plan Free) ; l'organisation dit sa vraie limite dans `license.apiLimit`. */
const DEFAULT_RATE_LIMIT_PER_MIN = 30;

export class MakeHttp {
  private readonly budgets = new Map<string, RateBudget>();

  constructor(private readonly rateLimitPerMin: number = DEFAULT_RATE_LIMIT_PER_MIN) {}

  async get<T>(instance: PlatformInstanceConfig, path: string): Promise<T> {
    return this.request<T>(instance, 'GET', path);
  }

  async request<T>(
    instance: PlatformInstanceConfig,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const zone = zoneOf(instance);
    await this.wait(zone);

    const res = await fetch(`https://${zone}/api/v2${path}`, {
      method,
      headers: {
        // Make attend littéralement « Token <jeton> » : un `Bearer` donne un 401
        // « Invalid token header », indistinguable d'un jeton absent.
        Authorization: `Token ${instance.apiKey}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : {};
    } catch {
      parsed = text;
    }

    if (!res.ok) {
      const payload = parsed as MakeApiErrorBody | string;
      const code = typeof payload === 'string' ? undefined : payload.code;
      throw new MakeApiError(res.status, path, code, makeErrorMessage(res.status, payload, zone));
    }
    return parsed as T;
  }

  /**
   * Le plafond est par ORGANISATION, donc partagé par tous les appels d'une même
   * zone : un budget par zone, et non par instance, sinon deux comptes de la même
   * organisation se croiraient chacun seuls et le dépasseraient à deux.
   */
  private async wait(zone: string): Promise<void> {
    let budget = this.budgets.get(zone);
    if (!budget) {
      budget = new RateBudget(this.rateLimitPerMin);
      this.budgets.set(zone, budget);
    }
    const delay = budget.delayMs();
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    budget.record();
  }
}

/**
 * La zone fait partie de l'identité d'un compte Make, pas seulement de son
 * adresse : un jeton `eu1` refusé sur `eu2` répond « Not authorized », le même
 * message qu'un droit manquant. Constaté, pas déduit — d'où le message explicite
 * de `makeErrorMessage`.
 */
export function zoneOf(instance: PlatformInstanceConfig): string {
  const zone = (instance.zone ?? instance.baseUrl ?? '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!zone) throw new Error('Instance Make sans zone : renseigner « eu1.make.com », « eu2.make.com »…');
  return zone;
}

/**
 * Make pagine par `pg[offset]` / `pg[limit]` et ne rend aucun curseur : on
 * avance tant qu'une page est pleine. La borne dure existe parce qu'une boucle
 * de pagination qui ne s'arrête pas brûle le budget d'appels de toute
 * l'organisation, pas seulement le nôtre.
 */
export async function paginate<T>(
  fetchPage: (offset: number, limit: number) => Promise<T[]>,
  { limit = 100, maxPages = 50 }: { limit?: number; maxPages?: number } = {},
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const rows = await fetchPage(page * limit, limit);
    all.push(...rows);
    if (rows.length < limit) return all;
  }
  return all;
}
