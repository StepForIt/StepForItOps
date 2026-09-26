import {
  N8nApiError,
  N8nApiPort,
  N8nCommunityPackage,
  N8nExecutionSummary,
  N8nExecutionsPage,
  N8nInstanceConfig,
  N8nNodeTypeDescription,
  N8nTag,
  N8nVersionedNodeType,
  N8nWorkflow,
  NodeTypeVersionRef,
  msg,
} from '@nwm/core';
import { n8nRequest } from './n8n-http';
import { n8nSessionGet, n8nSessionPost } from './n8n-session';

interface ListResponse<T> {
  data: T[];
  nextCursor?: string | null;
}

/**
 * Clés que l'API publique accepte dans `settings` — son schéma est fermé
 * (`must NOT have additional properties`) et il est plus étroit que ce que l'éditeur
 * n8n écrit dans le JSON. Un sous-workflow qui restreint ses appelants porte
 * `callerPolicy` / `callerIds`, absents de ce schéma : renvoyé tel quel, il faisait
 * échouer la création en 400. Ces réglages-là ne se recopient donc pas — la copie
 * repart sur la politique par défaut de l'instance.
 */
const WRITABLE_SETTINGS = [
  'executionOrder',
  'executionTimeout',
  'errorWorkflow',
  'timezone',
  'saveExecutionProgress',
  'saveManualExecutions',
  'saveDataErrorExecution',
  'saveDataSuccessExecution',
];

/**
 * Champs acceptés par POST/PUT /workflows (l'API refuse les champs en lecture seule).
 * `pinData` en fait partie et doit passer quand n8n l'accepte : c'est lui qui empêche
 * un nœud de s'exécuter. Le laisser tomber donne une copie de test qui envoie pour de vrai.
 */
function toWritableWorkflow(workflow: N8nWorkflow): Partial<N8nWorkflow> {
  const settings = workflow.settings ?? {};
  const pinData = workflow.pinData ?? {};
  return {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: Object.fromEntries(
      Object.entries(settings).filter(([key, value]) => WRITABLE_SETTINGS.includes(key) && value !== null),
    ),
    ...(Object.keys(pinData).length > 0 ? { pinData } : {}),
  };
}

/**
 * `pinData` ne figure PAS dans le schéma d'écriture de toutes les versions de n8n, et ce
 * schéma est fermé : l'instance répond alors `400 must NOT have additional properties` et
 * refuse l'écriture ENTIÈRE — un simple renommage échouait à cause d'épingles qu'on ne
 * cherchait même pas à poser. On retente donc sans elles. Les seuls appelants qui comptent
 * dessus (copie bouchonnée, duplication vers un env) relisent le workflow créé et refusent
 * la copie si les épingles manquent : le bouchon perdu est constaté, jamais supposé.
 */
function rejectsPinData(error: unknown): boolean {
  return (
    error instanceof N8nApiError &&
    error.status === 400 &&
    /must NOT have additional properties/i.test(error.message)
  );
}

async function writeWorkflow(
  instance: N8nInstanceConfig,
  method: 'POST' | 'PUT',
  path: string,
  workflow: N8nWorkflow,
): Promise<N8nWorkflow> {
  const body = toWritableWorkflow(workflow);
  try {
    return await n8nRequest<N8nWorkflow>(instance, method, path, body);
  } catch (error) {
    if (body.pinData === undefined || !rejectsPinData(error)) throw error;
    const { pinData: _unsupported, ...withoutPinData } = body;
    return n8nRequest<N8nWorkflow>(instance, method, path, withoutPinData);
  }
}

/** Plafond d'attente d'un webhook : au-delà, la requête appelante ne sert plus à rien. */
const WEBHOOK_TIMEOUT_MS = 120_000;

export class N8nApiAdapter implements N8nApiPort {
  async listWorkflows(instance: N8nInstanceConfig): Promise<N8nWorkflow[]> {
    const all: N8nWorkflow[] = [];
    let cursor: string | undefined;
    do {
      const query = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : '?limit=100';
      const page = await n8nRequest<ListResponse<N8nWorkflow>>(instance, 'GET', `/workflows${query}`);
      all.push(...page.data);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return all;
  }

  getWorkflow(instance: N8nInstanceConfig, workflowId: string): Promise<N8nWorkflow> {
    return n8nRequest<N8nWorkflow>(instance, 'GET', `/workflows/${workflowId}`);
  }

  createWorkflow(instance: N8nInstanceConfig, workflow: N8nWorkflow): Promise<N8nWorkflow> {
    return writeWorkflow(instance, 'POST', '/workflows', workflow);
  }

  updateWorkflow(
    instance: N8nInstanceConfig,
    workflowId: string,
    workflow: N8nWorkflow,
  ): Promise<N8nWorkflow> {
    return writeWorkflow(instance, 'PUT', `/workflows/${workflowId}`, workflow);
  }

  async activateWorkflow(instance: N8nInstanceConfig, workflowId: string, active: boolean): Promise<void> {
    await n8nRequest(instance, 'POST', `/workflows/${workflowId}/${active ? 'activate' : 'deactivate'}`);
  }

  /**
   * `/publish` sans corps : n8n publie la dernière version. Lui passer un
   * `versionId` supposerait qu'on sache laquelle, alors qu'on vient précisément
   * d'écrire celle qu'on veut voir tourner.
   *
   * Sur un n8n 1.x la route n'existe pas (404) : l'appelant ne doit la tenter que
   * lorsque `detectPublishModel` a reconnu une instance à versions.
   */
  async publishWorkflow(instance: N8nInstanceConfig, workflowId: string): Promise<void> {
    await n8nRequest(instance, 'POST', `/workflows/${workflowId}/publish`, {});
  }

  async deleteWorkflow(instance: N8nInstanceConfig, workflowId: string): Promise<void> {
    await n8nRequest(instance, 'DELETE', `/workflows/${workflowId}`);
  }

  async listExecutions(
    instance: N8nInstanceConfig,
    workflowId: string,
    limit = 20,
    options?: { includeData?: boolean; status?: 'success' | 'error' },
  ): Promise<N8nExecutionSummary[]> {
    const params = new URLSearchParams({ workflowId, limit: String(limit) });
    if (options?.includeData) params.set('includeData', 'true');
    if (options?.status) params.set('status', options.status);
    const page = await n8nRequest<ListResponse<N8nExecutionSummary>>(
      instance,
      'GET',
      `/executions?${params.toString()}`,
    );
    return page.data;
  }

  getExecution(
    instance: N8nInstanceConfig,
    executionId: string,
    options?: { includeData?: boolean },
  ): Promise<N8nExecutionSummary> {
    const query = options?.includeData ? '?includeData=true' : '';
    return n8nRequest<N8nExecutionSummary>(
      instance,
      'GET',
      `/executions/${encodeURIComponent(executionId)}${query}`,
    );
  }

  async listAllExecutions(
    instance: N8nInstanceConfig,
    options?: { limit?: number; cursor?: string },
  ): Promise<N8nExecutionsPage> {
    const params = new URLSearchParams({ limit: String(options?.limit ?? 100) });
    if (options?.cursor) params.set('cursor', options.cursor);
    const page = await n8nRequest<ListResponse<N8nExecutionSummary>>(
      instance,
      'GET',
      `/executions?${params.toString()}`,
    );
    return { executions: page.data, nextCursor: page.nextCursor ?? undefined };
  }

  async listErrorExecutions(
    instance: N8nInstanceConfig,
    options?: { limit?: number; cursor?: string },
  ): Promise<N8nExecutionsPage> {
    const params = new URLSearchParams({ status: 'error', limit: String(options?.limit ?? 50) });
    if (options?.cursor) params.set('cursor', options.cursor);
    const page = await n8nRequest<ListResponse<N8nExecutionSummary>>(
      instance,
      'GET',
      `/executions?${params.toString()}`,
    );
    return { executions: page.data, nextCursor: page.nextCursor ?? undefined };
  }

  async listTags(instance: N8nInstanceConfig): Promise<N8nTag[]> {
    const page = await n8nRequest<ListResponse<N8nTag>>(instance, 'GET', '/tags?limit=100');
    return page.data;
  }

  createTag(instance: N8nInstanceConfig, name: string): Promise<N8nTag> {
    return n8nRequest<N8nTag>(instance, 'POST', '/tags', { name });
  }

  async setWorkflowTags(instance: N8nInstanceConfig, workflowId: string, tagIds: string[]): Promise<void> {
    await n8nRequest(
      instance,
      'PUT',
      `/workflows/${workflowId}/tags`,
      tagIds.map((id) => ({ id })),
    );
  }

  async callWebhook(
    instance: N8nInstanceConfig,
    path: string,
    payload: unknown,
    method = 'POST',
  ): Promise<unknown> {
    const url = `${instance.baseUrl.replace(/\/$/, '')}/webhook/${path.replace(/^\//, '')}`;
    // Un webhook en responseMode `lastNode` ne répond qu'à la fin du workflow :
    // sans plafond, l'appel garde la requête HTTP de la plateforme ouverte sans fin.
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify(payload ?? {}),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
    } catch (error) {
      const reason =
        (error as Error).name === 'TimeoutError'
          ? msg('platform.webhookTimeout', { seconds: Math.round(WEBHOOK_TIMEOUT_MS / 1000) })
          : (error as Error).message;
      throw new Error(msg('platform.webhookUnreachable', { path, reason }));
    }
    const text = await response.text().catch(() => '');
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* réponse non-JSON, on garde le texte */
    }
    if (!response.ok) {
      throw new Error(`Webhook ${path} → ${response.status}: ${text.slice(0, 500)}`);
    }
    return body;
  }

  /**
   * Types de nœuds servis par CETTE instance. Hors `/api/v1` : c'est un fichier
   * statique que n8n protège par la session navigateur, d'où le compte n8n.
   */
  async listNodeTypes(instance: N8nInstanceConfig): Promise<N8nNodeTypeDescription[]> {
    const payload = await n8nSessionGet<unknown>(instance, '/types/nodes.json');
    // n8n a servi un tableau à plat depuis toujours ; l'objet indexé est admis
    // par prudence, un format inattendu se dit au lieu de rendre une liste vide
    // qui passerait pour « cette instance n'a aucun nœud ».
    if (Array.isArray(payload)) return payload as N8nNodeTypeDescription[];
    if (payload && typeof payload === 'object') {
      return Object.values(payload as Record<string, N8nNodeTypeDescription>);
    }
    throw new N8nApiError(msg('platform.n8nNodeTypesUnexpected'), 502);
  }

  /**
   * Descriptions PAR VERSION, par la route que l'éditeur n8n s'appelle à
   * lui-même quand il ouvre un vieux nœud (`POST /rest/node-types`, corps
   * `{ nodeInfos: [{ name, version }] }`).
   *
   * n8n résout les descriptions en `Promise.all` : un seul couple inconnu — un
   * nœud communautaire désinstallé, une version qui n'a jamais existé — fait
   * échouer TOUT le lot. D'où la découpe en deux à chaque échec (`describe`) :
   * quelques appels suffisent à isoler les fautifs, là où un repli couple par
   * couple ferait une requête par nœud du parc.
   */
  async listNodeTypeDescriptions(
    instance: N8nInstanceConfig,
    refs: NodeTypeVersionRef[],
  ): Promise<N8nVersionedNodeType[]> {
    const wanted = [...new Map(refs.map((ref) => [`${ref.name}@${ref.version}`, ref])).values()];
    if (wanted.length === 0) return [];
    const found: N8nVersionedNodeType[] = [];
    for (let start = 0; start < wanted.length; start += NODE_TYPES_BATCH) {
      found.push(...(await describe(instance, wanted.slice(start, start + NODE_TYPES_BATCH))));
    }
    return found;
  }

  async listCommunityPackages(instance: N8nInstanceConfig): Promise<N8nCommunityPackage[]> {
    const payload = await n8nSessionGet<unknown>(instance, '/rest/community-packages');
    const list = payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload;
    if (!Array.isArray(list)) return [];
    return list
      .filter((entry): entry is { packageName: string; installedVersion?: unknown } =>
        Boolean(entry && typeof entry.packageName === 'string'),
      )
      .map((entry) => ({
        packageName: entry.packageName,
        ...(typeof entry.installedVersion === 'string' ? { installedVersion: entry.installedVersion } : {}),
      }));
  }

  async listNodeTypeVersions(instance: N8nInstanceConfig): Promise<Record<string, number[]>> {
    const payload = await n8nSessionGet<unknown>(instance, '/types/node-versions.json');
    if (!payload || typeof payload !== 'object') return {};
    const versions: Record<string, number[]> = {};
    for (const [nodeType, value] of Object.entries(payload as Record<string, unknown>)) {
      const list = (Array.isArray(value) ? value : [value])
        .map((entry) => Number(entry))
        .filter((entry) => Number.isFinite(entry));
      if (list.length > 0) versions[nodeType] = list;
    }
    return versions;
  }
}

/** Taille d'un lot demandé à `/rest/node-types`. Assez gros pour être rare, assez petit pour se rejouer. */
const NODE_TYPES_BATCH = 50;

/**
 * Un lot, ou ses deux moitiés si n8n le refuse. Un lot d'UN seul couple qui
 * échoue est le couple fautif : on l'abandonne, sans rien dire de plus — c'est
 * une version que l'instance ne décrit pas, pas une panne.
 */
async function describe(
  instance: N8nInstanceConfig,
  refs: NodeTypeVersionRef[],
): Promise<N8nVersionedNodeType[]> {
  try {
    const payload = await n8nSessionPost<unknown>(instance, '/rest/node-types', {
      nodeInfos: refs.map((ref) => ({ name: ref.name, version: ref.version })),
    });
    const list = Array.isArray(payload) ? payload : [];
    const found: N8nVersionedNodeType[] = [];
    // n8n rend les descriptions DANS L'ORDRE demandé : c'est ce qui rattache
    // chacune à sa version, la description elle-même portant la liste complète
    // des versions de son implémentation et non celle qu'on a demandée.
    refs.forEach((ref, index) => {
      const description = list[index] as N8nNodeTypeDescription | null | undefined;
      if (description && typeof description === 'object' && Array.isArray(description.properties)) {
        found.push({ ...ref, description });
      }
    });
    return found;
  } catch (error) {
    if (refs.length <= 1) return [];
    // Un 401/403 ne se scinde pas en deux : c'est la session, pas le contenu.
    if (error instanceof N8nApiError && (error.status === 401 || error.status === 403)) throw error;
    const middle = Math.floor(refs.length / 2);
    return [
      ...(await describe(instance, refs.slice(0, middle))),
      ...(await describe(instance, refs.slice(middle))),
    ];
  }
}
