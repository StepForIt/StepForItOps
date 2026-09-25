import { VcsPort, VcsRepo, VcsTargetConfig } from '@nwm/core';

interface GetContentResponse {
  sha?: string;
}

interface GithubRepoResponse {
  name: string;
  full_name: string;
  default_branch: string;
  private: boolean;
  owner: { login: string };
}

/**
 * L'API Contents publie la nouvelle tête de branche avec un temps de retard :
 * deux écritures rapprochées sur la même branche se voient refuser en 409
 * (« is at <sha> but expected <sha> »). Un export global enchaîne les commits →
 * on retente en relisant le sha du fichier, avec une pause croissante.
 */
const CONFLICT_ATTEMPTS = 5;
const CONFLICT_BACKOFF_MS = 600;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Adapter GitHub : commits via l'API Contents + découverte repos/branches. */
export class GithubVcsAdapter implements VcsPort {
  private headers(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    };
  }

  private async request<T>(token: string, path: string): Promise<T> {
    const response = await fetch(`https://api.github.com${path}`, { headers: this.headers(token) });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`GitHub ${path} → ${response.status}: ${text.slice(0, 200)}`);
    }
    return (await response.json()) as T;
  }

  /** sha du fichier sur la branche, `undefined` s'il n'existe pas encore. */
  private async fileSha(config: VcsTargetConfig, base: string, branch: string): Promise<string | undefined> {
    const existing = await fetch(`${base}?ref=${encodeURIComponent(branch)}`, {
      headers: this.headers(config.token),
    });
    if (!existing.ok) return undefined;
    return ((await existing.json()) as GetContentResponse).sha;
  }

  /**
   * Rejoue l'écriture tant que GitHub répond 409 (tête de branche décalée) :
   * le sha du fichier est relu à chaque tentative, il peut avoir bougé lui aussi.
   */
  private async writeWithRetry(
    label: string,
    write: (sha: string | undefined) => Promise<Response>,
    readSha: () => Promise<string | undefined>,
  ): Promise<Response> {
    for (let attempt = 1; ; attempt += 1) {
      const response = await write(await readSha());
      if (response.ok) return response;
      const text = await response.text().catch(() => '');
      if (response.status === 409 && attempt < CONFLICT_ATTEMPTS) {
        await delay(CONFLICT_BACKOFF_MS * attempt);
        continue;
      }
      throw new Error(`GitHub ${label} → ${response.status}: ${text.slice(0, 300)}`);
    }
  }

  async commitFile(
    config: VcsTargetConfig,
    params: { path: string; content: string; message: string },
  ): Promise<{ url?: string }> {
    const branch = config.branch ?? 'main';
    const base = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${params.path}`;

    const response = await this.writeWithRetry(
      `commit ${params.path}`,
      // sha requis pour mettre à jour un fichier existant
      (sha) =>
        fetch(base, {
          method: 'PUT',
          headers: this.headers(config.token),
          body: JSON.stringify({
            message: params.message,
            content: Buffer.from(params.content, 'utf8').toString('base64'),
            branch,
            ...(sha ? { sha } : {}),
          }),
        }),
      () => this.fileSha(config, base, branch),
    );
    const json = (await response.json()) as { content?: { html_url?: string } };
    return { url: json.content?.html_url };
  }

  async deleteFile(
    config: VcsTargetConfig,
    params: { path: string; message: string },
  ): Promise<{ deleted: boolean }> {
    const branch = config.branch ?? 'main';
    const base = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${params.path}`;

    const sha = await this.fileSha(config, base, branch);
    if (!sha) return { deleted: false }; // rien à supprimer

    await this.writeWithRetry(
      `delete ${params.path}`,
      (current) =>
        fetch(base, {
          method: 'DELETE',
          headers: this.headers(config.token),
          body: JSON.stringify({ message: params.message, sha: current ?? sha, branch }),
        }),
      () => this.fileSha(config, base, branch),
    );
    return { deleted: true };
  }

  async listFiles(config: VcsTargetConfig, params: { path: string }): Promise<string[]> {
    const branch = config.branch ?? 'main';
    // L'API Trees donne l'arbre complet en un appel (vs 1 appel par dossier).
    const tree = await this.request<{ tree?: Array<{ path: string; type: string }> }>(
      config.token,
      `/repos/${config.owner}/${config.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    );
    const prefix = params.path.replace(/\/$/, '');
    return (tree.tree ?? [])
      .filter((entry) => entry.type === 'blob' && entry.path.startsWith(`${prefix}/`))
      .map((entry) => entry.path);
  }

  async readFile(config: VcsTargetConfig, params: { path: string }): Promise<string | null> {
    const branch = config.branch ?? 'main';
    const response = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${params.path}?ref=${encodeURIComponent(branch)}`,
      { headers: { ...this.headers(config.token), Accept: 'application/vnd.github.raw' } },
    );
    if (!response.ok) return null;
    return response.text();
  }

  async testAccess(config: VcsTargetConfig): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.request<GithubRepoResponse>(config.token, `/repos/${config.owner}/${config.repo}`);
      if (config.branch) {
        await this.request(config.token, `/repos/${config.owner}/${config.repo}/branches/${config.branch}`);
      }
      return { ok: true, error: undefined };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  async listRepos(token: string): Promise<VcsRepo[]> {
    const repos: VcsRepo[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const batch = await this.request<GithubRepoResponse[]>(
        token,
        `/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
      );
      repos.push(
        ...batch.map((r) => ({
          owner: r.owner.login,
          name: r.name,
          fullName: r.full_name,
          defaultBranch: r.default_branch,
          private: r.private,
        })),
      );
      if (batch.length < 100) break;
    }
    return repos;
  }

  async listBranches(config: Omit<VcsTargetConfig, 'branch'>): Promise<string[]> {
    const branches = await this.request<Array<{ name: string }>>(
      config.token,
      `/repos/${config.owner}/${config.repo}/branches?per_page=100`,
    );
    return branches.map((b) => b.name);
  }
}
