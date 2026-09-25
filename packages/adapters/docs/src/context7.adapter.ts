import { DocsExcerpt, DocsLibrary, DocsPort } from '@nwm/core';

/**
 * Documentation tierce, servie par Context7.
 *
 * Pourquoi celui-là : il indexe la doc officielle de milliers de produits et la
 * rend en Markdown resserré sur un sujet, sans qu'on ait à écrire un connecteur
 * par API. L'alternative — un fetch de la page de doc — rend du HTML de portail
 * dont l'essentiel est de la navigation, et coûte un contexte entier pour trois
 * lignes utiles.
 *
 * Deux routes, et deux versions d'API : la RECHERCHE est documentée en v2
 * (`/api/v2/libs/search`), la LECTURE ne l'est qu'en v1 (`/api/v1<libraryId>`).
 * Ce n'est pas une négligence : la v2 répond 404 sur la route de lecture, les
 * deux ont été essayées. Le jour où la lecture passe en v2, c'est ici et nulle
 * part ailleurs que ça se change.
 *
 * La clé est FACULTATIVE : sans elle l'API répond, plafonnée par IP. On ne la
 * rend donc jamais obligatoire — une plateforme sans compte Context7 garde
 * l'outil, avec moins de débit.
 */

const SEARCH_URL = 'https://context7.com/api/v2/libs/search';
const DOCS_BASE_URL = 'https://context7.com/api/v1';

/** Une doc n'est jamais sur le chemin critique : mieux vaut l'absence que l'attente. */
const TIMEOUT_MS = 20 * 1000;

/** Budget par défaut d'un extrait. Assez pour un endpoint et ses exemples. */
const DEFAULT_TOKENS = 4000;
const MAX_TOKENS = 12000;

/** Résultat de recherche amont, réduit à ce dont on se sert. */
interface SearchHit {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  trustScore?: unknown;
  totalSnippets?: unknown;
  versions?: unknown;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export class Context7DocsAdapter implements DocsPort {
  readonly sourceName = 'Context7';

  /** Clé lue à chaque appel : posée après coup, elle prend effet sans redémarrage. */
  private headers(): Record<string, string> {
    const key = process.env.CONTEXT7_API_KEY?.trim();
    return {
      Accept: 'application/json',
      'User-Agent': 'nwm-docs',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    };
  }

  private async get(url: string, accept: string): Promise<Response> {
    return fetch(url, {
      headers: { ...this.headers(), Accept: accept },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  async searchLibraries(input: { libraryName: string; query: string }): Promise<DocsLibrary[]> {
    const url = new URL(SEARCH_URL);
    url.searchParams.set('libraryName', input.libraryName.slice(0, 500));
    url.searchParams.set('query', input.query.slice(0, 500));
    // Le reclassement par LLM ajoute plusieurs secondes à un tour qui en dure
    // déjà des dizaines, pour un classement que le modèle refait lui-même en
    // lisant les titres.
    url.searchParams.set('fast', 'true');

    const response = await this.get(url.toString(), 'application/json');
    if (!response.ok) {
      throw new Error(
        `Context7 recherche → ${response.status} ${(await response.text().catch(() => '')).slice(0, 200)}`,
      );
    }
    const body = (await response.json()) as { results?: SearchHit[] };
    return (body.results ?? [])
      .map((hit): DocsLibrary | null => {
        const id = text(hit.id);
        const title = text(hit.title);
        if (!id || !title) return null;
        const versions = Array.isArray(hit.versions)
          ? hit.versions.filter((version): version is string => typeof version === 'string')
          : undefined;
        return {
          id,
          title,
          ...(text(hit.description) ? { description: text(hit.description)! } : {}),
          ...(num(hit.trustScore) !== undefined ? { trustScore: num(hit.trustScore)! } : {}),
          ...(num(hit.totalSnippets) !== undefined ? { snippets: num(hit.totalSnippets)! } : {}),
          ...(versions?.length ? { versions } : {}),
        };
      })
      .filter((library): library is DocsLibrary => library !== null);
  }

  async readDocs(input: { libraryId: string; topic?: string; tokens?: number }): Promise<DocsExcerpt | null> {
    // L'identifiant amont commence par « / » et se concatène tel quel. On ne le
    // ré-encode pas : il porte ses propres barres (`/vercel/next.js/v14`).
    const path = input.libraryId.startsWith('/') ? input.libraryId : `/${input.libraryId}`;
    const url = new URL(`${DOCS_BASE_URL}${path}`);
    url.searchParams.set('type', 'txt');
    if (input.topic?.trim()) url.searchParams.set('topic', input.topic.trim());
    url.searchParams.set('tokens', String(Math.min(input.tokens ?? DEFAULT_TOKENS, MAX_TOKENS)));

    const response = await this.get(url.toString(), 'text/plain');
    // Un identifiant inconnu n'est pas une panne : c'est une réponse, et le
    // modèle doit pouvoir la recevoir pour chercher autrement.
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(
        `Context7 lecture → ${response.status} ${(await response.text().catch(() => '')).slice(0, 200)}`,
      );
    }
    const content = (await response.text()).trim();
    if (!content) return null;
    return {
      libraryId: path,
      ...(input.topic?.trim() ? { topic: input.topic.trim() } : {}),
      content,
    };
  }
}
