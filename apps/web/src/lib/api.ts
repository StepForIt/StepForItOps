import { createTranslator } from 'next-intl';
import { LockedWorkflow, lockedFromRefusal, overrideHeaders } from './workflow-lock/lock-override';
import { isLocale } from '../i18n/locale';
import frShell from '../../messages/fr/shell.json';
import enShell from '../../messages/en/shell.json';

// Par défaut : proxy Next (/backend → API via le réseau interne, cf. next.config.js).
// NEXT_PUBLIC_API_URL permet de pointer directement une API distante si besoin.
export const API_URL = process.env.NEXT_PUBLIC_API_URL || '/backend';

/**
 * Hors React, pas de `useTranslations` : la langue est celle que le layout pose sur
 * `<html lang>`, et seuls les messages de cet espace sont embarqués ici.
 */
function apiT() {
  const lang = typeof document === 'undefined' ? undefined : document.documentElement.lang;
  const locale = isLocale(lang) ? lang : 'fr';
  return createTranslator({
    locale,
    // Seul `shell` est embarqué ; `namespace` borne les clés lues à `shell.api`.
    messages: { shell: locale === 'en' ? enShell : frShell } as unknown as IntlMessages,
    namespace: 'shell.api',
  });
}

/**
 * Message d'erreur exploitable : JSON Nest → son `message` (stack en console si DEBUG_ERRORS=1) ;
 * réponse non JSON → c'est le proxy Next qui répond, l'API est injoignable, pas plantée.
 */
function errorFromBody(path: string, status: number, text: string): Error {
  try {
    const payload = JSON.parse(text) as { message?: string | string[]; stack?: string[] };
    const message = Array.isArray(payload.message) ? payload.message.join(' · ') : payload.message;
    if (payload.stack) {
      // eslint-disable-next-line no-console
      console.error(`${path} → ${status}\n${payload.stack.join('\n')}`);
    }
    if (message) return new Error(`${path} → ${status}: ${message}`);
  } catch {
    // corps non JSON : on retombe sur le texte brut
  }
  if (status >= 500 && !text.trim().startsWith('{')) {
    return new Error(apiT()('unreachableStatus', { path, status }));
  }
  return new Error(`${path} → ${status}: ${text.slice(0, 300)}`);
}

/**
 * Appel annulé par l'appelant (`signal`) : ce n'est ni une panne ni un résultat,
 * et le confondre avec une erreur réseau afficherait « API injoignable » à chaque
 * lettre tapée dans une recherche.
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : (error as Error)?.name === 'AbortError';
}

type WriteListener = (write: { method: string; path: string; body: unknown }) => void;

const writeListeners = new Set<WriteListener>();

/**
 * Écoute les écritures RÉUSSIES faites par la console : c'est ce que l'enregistreur
 * de procédures capte. Rend la fonction de désabonnement.
 */
export function onApiWrite(listener: WriteListener): () => void {
  writeListeners.add(listener);
  return () => writeListeners.delete(listener);
}

/** Demande à l'humain s'il force le verrou : rend sa raison, ou null s'il renonce. */
type LockOverrideAsk = (locked: LockedWorkflow[]) => Promise<string | null>;

let askLockOverride: LockOverrideAsk | null = null;

/** Posé par la modale de forçage, montée une fois dans la console. */
export function setLockOverrideHandler(handler: LockOverrideAsk): () => void {
  askLockOverride = handler;
  return () => {
    if (askLockOverride === handler) askLockOverride = null;
  };
}

/**
 * Une écriture refusée par un verrou (423) ouvre la modale de forçage, puis part
 * à nouveau avec les workflows levés NOMMÉS : c'est ici, et non dans chaque
 * écran, parce qu'une vingtaine de gestes peuvent buter sur un verrou. Un geste
 * qui en touche plusieurs peut en rencontrer un second : la modale revient, et
 * les levées s'additionnent.
 */
async function apiRequest<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let lifted: string[] = [];
  let reason = '';
  for (;;) {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(lifted.length > 0 ? overrideHeaders(lifted, reason) : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    }).catch((error: unknown) => {
      if (isAbortError(error)) throw error;
      throw new Error(apiT()('unreachableNetwork', { path }));
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const locked = lockedFromRefusal(response.status, text);
      const fresh = locked?.filter((workflow) => !lifted.includes(workflow.id)) ?? [];
      if (locked && fresh.length > 0 && askLockOverride) {
        const answer = await askLockOverride(locked);
        if (answer === null) {
          throw new Error(
            apiT()('writeCancelled', {
              names: locked.map((w) => apiT()('quotedName', { name: w.name })).join(', '),
            }),
          );
        }
        lifted = [...new Set([...lifted, ...locked.map((workflow) => workflow.id)])];
        reason = answer;
        continue;
      }
      throw errorFromBody(path, response.status, text);
    }
    const result = (await response.json()) as T;
    if (method !== 'GET') writeListeners.forEach((listener) => listener({ method, path, body }));
    return result;
  }
}

/** Appels d'action custom (endpoints hors CRUD Refine). */
export function apiPost<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return apiRequest<T>('POST', path, body, signal);
}

export function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>('PUT', path, body);
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>('PATCH', path, body);
}

export function apiDelete<T>(path: string): Promise<T> {
  return apiRequest<T>('DELETE', path);
}

export function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return apiRequest<T>('GET', path, undefined, signal);
}
