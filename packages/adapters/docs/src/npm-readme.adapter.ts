import { PackageDocsPort, PackageReadme, msg } from '@nwm/core';

/**
 * README d'un paquet de nœuds communautaires, lu sur le registre npm puis, à
 * défaut, sur le dépôt GitHub que le paquet déclare.
 *
 * Le registre ne garde le README que de la DERNIÈRE version publiée (champ
 * `readme` de la fiche) ; celui d'une version antérieure n'y est que lorsque
 * l'auteur l'a publiée avec un client npm ancien. On le prend quand il existe,
 * et le résultat dit toujours de quelle version il parle.
 */

const REGISTRY_URL = 'https://registry.npmjs.org';
const TIMEOUT_MS = 20 * 1000;
/** Un README plus gros est un changelog déguisé : on garde le début. */
const MAX_CHARS = 200_000;
/** Une page désignée par un humain : au-delà, ce n'est plus une doc de nœud. */
const MAX_DOCUMENT_BYTES = 512 * 1024;

/** Ce que npm écrit à la place d'un README absent. */
const NO_README = /^ERROR: No README data found!?$/i;

interface Packument {
  readme?: unknown;
  'dist-tags'?: { latest?: unknown };
  versions?: Record<string, { readme?: unknown; repository?: unknown }>;
  repository?: unknown;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && !NO_README.test(trimmed) ? trimmed.slice(0, MAX_CHARS) : undefined;
}

/** `git+https://github.com/o/r.git`, `github:o/r`, `{ url, directory }` → propriétaire, dépôt, dossier. */
export function githubRepoOf(
  repository: unknown,
): { owner: string; repo: string; directory?: string } | null {
  const raw =
    typeof repository === 'string'
      ? repository
      : repository && typeof repository === 'object' && 'url' in repository
        ? String((repository as { url: unknown }).url)
        : '';
  const directory =
    repository && typeof repository === 'object' && 'directory' in repository
      ? String((repository as { directory: unknown }).directory)
      : undefined;
  const match = /github(?:\.com[/:]|:)([^/\s]+)\/([^/\s#]+?)(?:\.git)?(?:[#/].*)?$/.exec(raw);
  if (!match) return null;
  return { owner: match[1], repo: match[2], ...(directory ? { directory } : {}) };
}

/** Le HTML d'un portail ramené à son texte : scripts, styles et balises retirés. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|nav|header|footer)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|li|h[1-6]|tr|pre)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<h([1-6])[^>]*>/gi, (_, level: string) => `\n${'#'.repeat(Number(level))} `)
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export class NpmReadmeAdapter implements PackageDocsPort {
  private async get(url: string, accept: string): Promise<Response> {
    return fetch(url, {
      headers: { Accept: accept, 'User-Agent': 'nwm-package-docs' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  async readme(packageName: string, version?: string): Promise<PackageReadme | null> {
    // Le scope garde son `@`, seul le `/` s'encode : c'est la forme que le registre attend.
    const response = await this.get(`${REGISTRY_URL}/${packageName.replace('/', '%2F')}`, 'application/json');
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(msg('platform.npmRegistryFailed', { status: response.status, packageName }));
    const packument = (await response.json()) as Packument;
    const latest = text(packument['dist-tags']?.latest);
    const pageUrl = `https://www.npmjs.com/package/${packageName}`;

    const exact = version ? text(packument.versions?.[version]?.readme) : undefined;
    if (exact) return { packageName, version, content: exact, source: 'npm', url: pageUrl };
    const current = text(packument.readme);
    if (current) {
      return {
        packageName,
        ...(latest ? { version: latest } : {}),
        content: current,
        source: 'npm',
        url: pageUrl,
      };
    }

    const repo = githubRepoOf((version && packument.versions?.[version]?.repository) || packument.repository);
    if (!repo) return null;
    const content = await this.githubReadme(repo);
    if (!content) return null;
    return {
      packageName,
      // Le README d'un dépôt décrit la branche par défaut, pas une version publiée.
      content,
      source: 'github',
      url: `https://github.com/${repo.owner}/${repo.repo}`,
    };
  }

  private async githubReadme(repo: {
    owner: string;
    repo: string;
    directory?: string;
  }): Promise<string | undefined> {
    const path = repo.directory ? `/${repo.directory.replace(/^\/+|\/+$/g, '')}` : '';
    const response = await this.get(
      `https://api.github.com/repos/${repo.owner}/${repo.repo}/readme${path}`,
      'application/vnd.github.raw',
    );
    if (!response.ok) return undefined;
    return text(await response.text());
  }

  async fetchDocument(url: string): Promise<string> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(msg('platform.docsHttpOnly'));
    }
    // Une page de paquet npm est une application JS : son README se lit au registre.
    const npmPage = /^\/package\/(.+)$/.exec(parsed.pathname);
    if (/(^|\.)npmjs\.com$/.test(parsed.hostname) && npmPage) {
      const readme = await this.readme(decodeURIComponent(npmPage[1]).replace(/\/v\/.*$/, ''));
      if (!readme) throw new Error(msg('platform.docsNoReadme'));
      return readme.content;
    }
    // Un fichier affiché par GitHub se lit brut, sans l'habillage du site.
    const blob = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(parsed.pathname);
    const target =
      parsed.hostname === 'github.com' && blob
        ? `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}`
        : parsed.toString();

    const response = await this.get(target, 'text/markdown, text/plain, text/html;q=0.9, */*;q=0.5');
    if (!response.ok) throw new Error(`${parsed.hostname} → ${response.status}`);
    const body = (await response.text()).slice(0, MAX_DOCUMENT_BYTES);
    const isHtml =
      /html/i.test(response.headers.get('content-type') ?? '') || /^\s*<(!doctype|html)/i.test(body);
    const content = (isHtml ? htmlToText(body) : body).trim();
    if (!content) throw new Error(msg('platform.docsEmptyPage'));
    return content;
  }
}
