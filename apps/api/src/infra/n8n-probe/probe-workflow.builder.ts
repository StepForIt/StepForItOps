import { randomUUID } from 'node:crypto';
import { N8nNode, N8nWorkflow, POSTGRES_COLUMNS_QUERY, ProbeHttpRequest } from '@nwm/core';

/** Préfixe de nom des workflows temporaires : c'est à lui qu'on les reconnaît sur l'instance. */
export const PROBE_WORKFLOW_PREFIX = '[NWM discovery]';

export interface ProbeWorkflowOptions {
  webhookPath: string;
  credentialType: string;
  credential: { id: string; name?: string };
  label: string;
}

function webhookNode(webhookPath: string): N8nNode {
  return {
    id: randomUUID(),
    name: 'Webhook',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    webhookId: randomUUID(),
    position: [0, 0],
    parameters: { httpMethod: 'POST', path: webhookPath, responseMode: 'responseNode', options: {} },
  };
}

function respondNode(respondWith: 'firstIncomingItem' | 'allIncomingItems'): N8nNode {
  return {
    id: randomUUID(),
    name: 'Respond',
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.1,
    position: [440, 0],
    parameters: { respondWith, options: {} },
  };
}

function chain(workflow: Omit<N8nWorkflow, 'connections'>, middle: string): N8nWorkflow {
  return {
    ...workflow,
    connections: {
      Webhook: { main: [[{ node: middle, type: 'main', index: 0 }]] },
      [middle]: { main: [[{ node: 'Respond', type: 'main', index: 0 }]] },
    },
  };
}

/**
 * Webhook → HTTP Request (authentifié par la credential existante, en
 * « predefined credential type ») → Respond. La requête arrive dans le CORPS
 * de l'appel au webhook (`{ url, method, headers, jsonBody }`) : un même
 * workflow sert autant d'appels qu'il faut, là où en créer un par requête
 * coûterait trois appels n8n de plus à chaque table.
 */
export function buildHttpProbeWorkflow(options: ProbeWorkflowOptions): N8nWorkflow {
  const { webhookPath, credentialType, credential, label } = options;
  return chain(
    {
      name: `${PROBE_WORKFLOW_PREFIX} ${label}`,
      active: false,
      nodes: [
        webhookNode(webhookPath),
        {
          id: randomUUID(),
          name: 'Fetch',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          position: [220, 0],
          parameters: {
            method: '={{ $json.body.method }}',
            url: '={{ $json.body.url }}',
            authentication: 'predefinedCredentialType',
            nodeCredentialType: credentialType,
            sendHeaders: true,
            specifyHeaders: 'json',
            jsonHeaders: '={{ JSON.stringify($json.body.headers) }}',
            sendBody: '={{ $json.body.jsonBody !== null }}',
            specifyBody: 'json',
            jsonBody: '={{ JSON.stringify($json.body.jsonBody) }}',
            // Un refus du provider n'est pas un plantage : `neverError` empêche n8n
            // d'avorter l'exécution (le webhook ne rendrait qu'un « Workflow execution
            // failed » muet) et `fullResponse` nous laisse lire le statut et le corps.
            // `json` et non l'auto-détection : sur trois caractères accentués d'affilée,
            // n8n retente le décodage en GB18030 et rend « caract猫res » pour « caractères ».
            options: {
              response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } },
            },
          },
          credentials: { [credentialType]: { id: credential.id, name: credential.name } },
          // Reste l'imprévu (DNS, TLS, credential absent) : qu'il arrive jusqu'au
          // Respond sous forme d'item d'erreur plutôt que de tuer l'exécution.
          onError: 'continueRegularOutput',
          alwaysOutputData: true,
        },
        respondNode('firstIncomingItem'),
      ],
      settings: {},
    },
    'Fetch',
  );
}

/** Corps d'appel d'une sonde HTTP : tous les champs posés, les expressions du nœud n'ont pas à deviner. */
export function httpProbePayload(request: ProbeHttpRequest): Record<string, unknown> {
  return {
    url: request.url,
    method: request.method ?? 'GET',
    headers: request.headers ?? {},
    jsonBody: request.jsonBody ?? null,
  };
}

/**
 * Webhook → Postgres (`information_schema.columns`) → Respond. Schéma et table
 * passent par `queryReplacement`, jamais dans le texte de la requête.
 */
export function buildPostgresProbeWorkflow(options: ProbeWorkflowOptions): N8nWorkflow {
  const { webhookPath, credentialType, credential, label } = options;
  return chain(
    {
      name: `${PROBE_WORKFLOW_PREFIX} ${label}`,
      active: false,
      nodes: [
        webhookNode(webhookPath),
        {
          id: randomUUID(),
          name: 'Columns',
          type: 'n8n-nodes-base.postgres',
          typeVersion: 2.5,
          position: [220, 0],
          parameters: {
            operation: 'executeQuery',
            query: POSTGRES_COLUMNS_QUERY,
            options: { queryReplacement: '={{ [$json.body.schema, $json.body.table] }}' },
          },
          credentials: { [credentialType]: { id: credential.id, name: credential.name } },
          onError: 'continueRegularOutput',
          alwaysOutputData: true,
        },
        respondNode('allIncomingItems'),
      ],
      settings: {},
    },
    'Columns',
  );
}
