import { createHash } from 'crypto';
import { DEFAULT_ENV_IDS } from '../env';
import { applyDeepReplace, Replacement } from '../json-replace';
import { stableJson } from '../stable-json';
import { workflowFamilyKey } from '../workflow-family';
import { paramString } from './n8n-params';
import { canonicalLocators } from './resource-locator-form';
import { hasEntryUrl, withDeclaredEntryPath } from './entry-path';
import { N8nNode, N8nWorkflow } from './workflow.types';

/** `values` d'un ResourceMapping : { dev: { baseId, tableIds: {...} }, prod: {...} }. */
export type DeployKeyMapping = Record<string, Record<string, unknown>>;

export interface DeployKeyContext {
  envs?: readonly string[];
  mappings?: readonly DeployKeyMapping[];
  /** Nom du workflow qui porte cet id sur l'instance de l'exemplaire (sous-workflow, workflow d'erreur). */
  workflowName?: (externalId: string) => string | undefined;
}

/**
 * Empreinte (sha1) de ce qu'une promotion TRANSPORTE d'un env à l'autre : deux
 * exemplaires de même clé sont identiques au sens où promouvoir l'un sur l'autre
 * ne changerait rien.
 *
 * Un sha1 du JSON brut dirait « différent » entre dev et prod par construction,
 * donc on neutralise exactement ce que la promotion réécrit ou préserve d'elle-même :
 * - les ids des ressources déclarées dans un mapping, ramenés à leur entrée de mapping ;
 * - les sous-workflows et le workflow d'erreur, ramenés au nom métier de la cible —
 *   un id n8n ne vaut que dans son instance ;
 * - le path et le `webhookId` des points d'entrée, que la promotion reprend de la cible ;
 * - le nom (suffixe d'env, numéro de version), les libellés affichés (`cachedResultName`,
 *   nom de credential), l'écriture d'un sélecteur (liste ou id tapé, `=id` sans gabarit),
 *   le `pinData`, les ids et positions de nœuds.
 *
 * Tout le reste compte, y compris une ressource NON mappée qui diffère entre les deux
 * envs : la promotion l'écraserait, c'est donc un vrai écart.
 */
export function deployKey(workflow: N8nWorkflow, context: DeployKeyContext = {}): string {
  return createHash('sha1')
    .update(stableJson(deployForm(workflow, context)))
    .digest('hex');
}

/**
 * Ce que `deployKey` hache, sous une forme de workflow : clés ordonnées, nom vidé,
 * rien de ce que la promotion neutralise. Deux exemplaires de même empreinte ont
 * exactement la même forme — c'est ce qui permet de MONTRER l'écart que la clé
 * se contente de constater (`deploy-diff.ts`).
 */
export function deployForm(workflow: N8nWorkflow, context: DeployKeyContext = {}): N8nWorkflow {
  const envs = context.envs ?? DEFAULT_ENV_IDS;
  const workflowRef = (externalId: string): string => {
    const name = context.workflowName?.(externalId);
    return name ? `⟨workflow:${workflowFamilyKey(name, envs)}⟩` : externalId;
  };

  const nodes = [...(workflow.nodes ?? [])]
    .map((node) => normalizeNode(node, workflowRef))
    .sort((a, b) => a.name.localeCompare(b.name));
  const settings: Record<string, unknown> = { ...(workflow.settings ?? {}) };
  if (typeof settings['errorWorkflow'] === 'string') {
    settings['errorWorkflow'] = workflowRef(settings['errorWorkflow']);
  }

  const significant = applyDeepReplace(
    { nodes, connections: workflow.connections ?? {}, settings },
    mappingTokens(context.mappings ?? []),
  );
  return { name: '', ...(JSON.parse(stableJson(significant)) as Omit<N8nWorkflow, 'name'>) };
}

function normalizeNode(node: N8nNode, workflowRef: (externalId: string) => string): N8nNode {
  const { id: _id, position: _position, webhookId: _webhookId, ...rest } = node;
  const parameters: Record<string, unknown> = withoutDisplayLabels(
    canonicalLocators({ ...(node.parameters ?? {}) }),
  ) as Record<string, unknown>;
  if (callsWorkflow(node)) {
    const externalId = paramString((node.parameters ?? {})['workflowId']);
    if (externalId && !externalId.includes('{{')) parameters['workflowId'] = workflowRef(externalId);
  }
  const credentials = node.credentials
    ? Object.fromEntries(Object.entries(node.credentials).map(([type, cred]) => [type, { id: cred.id }]))
    : undefined;
  const entry = hasEntryUrl(node) ? withDeclaredEntryPath({ ...node, parameters }, undefined) : undefined;
  return { ...rest, parameters: entry?.parameters ?? parameters, ...(credentials ? { credentials } : {}) };
}

function callsWorkflow(node: N8nNode): boolean {
  const type = node.type.toLowerCase();
  return !type.endsWith('trigger') && (type.includes('toolworkflow') || type.includes('executeworkflow'));
}

/** Les libellés d'un resourceLocator suivent la ressource ; seul l'id (`value`) dit ce qui est visé. */
function withoutDisplayLabels(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutDisplayLabels);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([key]) => key !== 'cachedResultName' && key !== 'cachedResultUrl',
    );
    return Object.fromEntries(entries.map(([key, inner]) => [key, withoutDisplayLabels(inner)]));
  }
  return value;
}

/**
 * Chaque id d'un mapping, quel que soit son env, remplacé par la même marque : l'id
 * dev et l'id prod d'une même table deviennent indiscernables. Les plus longs d'abord,
 * pour qu'un id qui en contient un autre ne soit pas coupé en deux.
 */
function mappingTokens(mappings: readonly DeployKeyMapping[]): Replacement[] {
  const replacements: Replacement[] = [];
  mappings.forEach((values, index) => {
    const walk = (value: unknown, path: string): void => {
      if (typeof value === 'string') {
        if (value.length >= 4) replacements.push({ from: value, to: `⟨mapping:${index}${path}⟩` });
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [key, inner] of Object.entries(value as Record<string, unknown>))
          walk(inner, `${path}.${key}`);
      }
    };
    for (const envValues of Object.values(values ?? {})) walk(envValues, '');
  });
  const seen = new Set<string>();
  return replacements
    .filter((r) => !seen.has(r.from) && seen.add(r.from))
    .sort((a, b) => b.from.length - a.from.length);
}
