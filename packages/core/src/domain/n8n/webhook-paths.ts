import { DEFAULT_ENVS, EnvDefinition, findEnv } from '../env';
import { EnvName } from '../env';
import { N8nNode, N8nWorkflow } from './workflow.types';
import {
  acceptsDeclaredPath,
  declaredEntryPath,
  entryUrlPath,
  hasEntryUrl,
  withDeclaredEntryPath,
} from './entry-path';

const WEBHOOK_TYPE = 'n8n-nodes-base.webhook';

/** Suffixe d'env déjà posé sur un path, quel que soit l'env déclaré. */
function envPathSuffix(envs: readonly EnvDefinition[]): RegExp {
  const ids = envs
    .map((env) => env.id)
    .sort((a, b) => b.length - a.length)
    .map((id) => id.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&'));
  return new RegExp(`-(${ids.join('|')})$`, 'i');
}

export interface WebhookPathChange {
  node: string;
  from: string;
  to: string;
}

/**
 * "commande" + dev → "commande-dev" ; "commande-prod" + dev → "commande-dev".
 *
 * Un env déclaré « path canonique » (la prod, par défaut) ne porte PAS de suffixe :
 * c'est lui que les appelants extérieurs connaissent, et un `-prod` dans l'URL
 * publique serait du bruit hérité de notre gestion d'envs. Promouvoir vers lui
 * retire donc le suffixe au lieu d'en poser un.
 *
 * Seul le PREMIER segment est touché : n8n autorise les paramètres d'URL
 * (`commande/:id`), et coller le suffixe à la fin renommerait le paramètre.
 */
export function envWebhookPath(
  path: string,
  env: EnvName,
  envs: readonly EnvDefinition[] = DEFAULT_ENVS,
): string {
  const clean = path.replace(/^\//, '');
  if (!clean) return path;
  const [first, ...rest] = clean.split('/');
  const base = first.replace(envPathSuffix(envs), '');
  const canonical = findEnv(envs, env)?.canonicalWebhookPath ?? false;
  return [canonical ? base : `${base}-${env}`, ...rest].join('/');
}

/**
 * Aligne les paths des points d'entrée sur leur destination.
 *
 * Un path est enregistré par n8n à l'échelle de l'INSTANCE, pas du workflow, d'où
 * deux règles opposées selon ce qu'on écrit :
 *
 * - `target` (on écrase un workflow qui existe déjà) : son path est celui que les
 *   appelants connaissent — formulaires publiés, systèmes tiers, liens en circulation.
 *   Le remplacer par celui de la source déplacerait l'URL de production sans prévenir,
 *   donc on REPREND celui de la cible, avec son `webhookId`.
 * - `env` sans contrepartie sur la cible (création) : le path de la source y est
 *   encore tenu par l'exemplaire actif, on le suffixe pour que la copie ait le sien.
 *
 * Les deux se croisent : un trigger ajouté depuis la dernière promotion n'a pas de
 * contrepartie à préserver et retombe sur le suffixe.
 */
export function alignWebhookPaths(
  workflow: N8nWorkflow,
  options: {
    target?: N8nWorkflow;
    env?: EnvName;
    /** Envs déclarés : ce qu'un path peut porter en suffixe, et qui porte l'URL publique. */
    envs?: readonly EnvDefinition[];
    freshId?: () => string;
  } = {},
): { workflow: N8nWorkflow; preserved: WebhookPathChange[]; changes: WebhookPathChange[] } {
  const { target, env, envs = DEFAULT_ENVS, freshId } = options;
  const counterparts = new Map<string, N8nNode>();
  for (const node of target?.nodes ?? []) {
    if (!hasEntryUrl(node)) continue;
    if (node.id) counterparts.set(`id:${node.id}`, node);
    counterparts.set(`name:${node.name}`, node);
  }

  const preserved: WebhookPathChange[] = [];
  const changes: WebhookPathChange[] = [];
  const nodes = workflow.nodes.map((node) => {
    if (!hasEntryUrl(node)) return node;
    const url = entryUrlPath(node);
    if (!url) return node;

    const counterpart = counterparts.get(`id:${node.id}`) ?? counterparts.get(`name:${node.name}`);
    const targetUrl = counterpart ? entryUrlPath(counterpart) : undefined;
    if (counterpart && targetUrl) {
      if (targetUrl === url) return node;
      preserved.push({ node: node.name, from: url, to: targetUrl });
      // Le chemin déclaré ET l'identifiant : sans path, c'est l'identifiant qui fait l'URL.
      return withDeclaredEntryPath(
        { ...node, ...(counterpart.webhookId ? { webhookId: counterpart.webhookId } : {}) },
        declaredEntryPath(counterpart),
      );
    }

    if (!env) return node;
    const path = declaredEntryPath(node);
    if (path === undefined && !acceptsDeclaredPath(node)) {
      // Sans path possible, l'identifiant EST l'URL, et la source le tient : seul un neuf la libère.
      if (!freshId) return node;
      const next = freshId();
      changes.push({ node: node.name, from: url, to: next });
      return { ...node, webhookId: next };
    }
    // Un formulaire sans path a son uuid pour base : `<uuid>-preprod`, puis `<uuid>` nu en prod.
    const next = envWebhookPath(path ?? url, env, envs);
    if (next === url) return node;
    changes.push({ node: node.name, from: path ?? url, to: next });
    // Le Webhook reçoit un identifiant neuf ; un formulaire garde son uuid, qui relie ses exemplaires.
    const renewed = node.type === WEBHOOK_TYPE && freshId ? { ...node, webhookId: freshId() } : node;
    return withDeclaredEntryPath(renewed, next === renewed.webhookId ? undefined : next);
  });
  return { workflow: { ...workflow, nodes }, preserved, changes };
}

/**
 * Donne aux points d'entrée d'une copie leur propre path, suffixé par l'env : le
 * cas de la duplication, où rien n'existe encore en face.
 */
export function applyEnvWebhookPaths(
  workflow: N8nWorkflow,
  env: EnvName,
  freshId?: () => string,
  envs?: readonly EnvDefinition[],
): { workflow: N8nWorkflow; changes: WebhookPathChange[] } {
  const { workflow: next, changes } = alignWebhookPaths(workflow, { env, envs, freshId });
  return { workflow: next, changes };
}
