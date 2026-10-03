// Fabriques de nœuds n8n, au format que sert l'API publique (`GET /api/v1/workflows/:id`).
//
// Le jeu de démo doit PASSER dans le vrai code de la plateforme — vérificateur,
// schéma, empreinte d'écart, promotion — : des nœuds de fantaisie donneraient
// des écrans vides ou des findings absurdes. D'où les formes exactes de n8n.
import { createHash } from 'node:crypto';

/** Un uuid stable dérivé d'une graine : rejouer la capture redonne les mêmes ids. */
export function uuid(seed) {
  const h = createHash('sha1').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const rl = (value, cachedResultName) => ({ __rl: true, mode: 'list', value, cachedResultName });

export const n = {
  manual: (name = 'Lancement manuel') => ({
    name,
    type: 'n8n-nodes-base.manualTrigger',
    typeVersion: 1,
    parameters: {},
  }),
  schedule: (name, cron) => ({
    name,
    type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.2,
    parameters: { rule: { interval: [{ field: 'cronExpression', expression: cron }] } },
  }),
  webhook: (name, path) => ({
    name,
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    webhookId: uuid(`webhook-${path}`),
    parameters: { httpMethod: 'POST', path, responseMode: 'onReceived', options: {} },
  }),
  subTrigger: (name = 'Appelé par un workflow') => ({
    name,
    type: 'n8n-nodes-base.executeWorkflowTrigger',
    typeVersion: 1.1,
    parameters: { inputSource: 'passthrough' },
  }),
  http: (name, method, url, extra = {}) => ({
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    parameters: { method, url, options: {}, ...extra },
  }),
  set: (name, fields) => ({
    name,
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    parameters: {
      assignments: {
        assignments: Object.entries(fields).map(([key, value]) => ({
          id: uuid(`${name}-${key}`),
          name: key,
          value,
          type: 'string',
        })),
      },
      options: {},
    },
  }),
  if: (name, left, right) => ({
    name,
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [
          {
            id: uuid(name),
            leftValue: left,
            rightValue: right,
            operator: { type: 'string', operation: 'equals' },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
  }),
  airtable: (name, operation, base, table) => ({
    name,
    type: 'n8n-nodes-base.airtable',
    typeVersion: 2.1,
    credentials: { airtableTokenApi: { id: 'cred-airtable', name: 'Airtable Maison Lumière' } },
    parameters: {
      operation,
      base: rl(base[0], base[1]),
      table: rl(table[0], table[1]),
      ...(operation === 'search' ? {} : { columns: { mappingMode: 'autoMapInputData', value: {} } }),
      options: {},
    },
  }),
  slack: (name, channel, text) => ({
    name,
    type: 'n8n-nodes-base.slack',
    typeVersion: 2.2,
    credentials: { slackApi: { id: 'cred-slack', name: 'Slack équipe' } },
    parameters: {
      select: 'channel',
      channelId: rl(`C0${channel.length}9X`, channel),
      text,
      otherOptions: {},
    },
  }),
  gmail: (name, sendTo, subject) => ({
    name,
    type: 'n8n-nodes-base.gmail',
    typeVersion: 2.1,
    credentials: { gmailOAuth2: { id: 'cred-gmail', name: 'Gmail contact@' } },
    parameters: { sendTo, subject, message: '={{ $json.message }}', options: {} },
  }),
  code: (name, jsCode) => ({
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    parameters: { jsCode },
  }),
  loop: (name = 'Par lot') => ({
    name,
    type: 'n8n-nodes-base.splitInBatches',
    typeVersion: 3,
    parameters: { batchSize: 10, options: {} },
  }),
  call: (name, workflowId, workflowName) => ({
    name,
    type: 'n8n-nodes-base.executeWorkflow',
    typeVersion: 1.1,
    parameters: { workflowId: rl(workflowId, workflowName), options: {} },
  }),
  agent: (name, prompt) => ({
    name,
    type: '@n8n/n8n-nodes-langchain.agent',
    typeVersion: 1.7,
    parameters: { promptType: 'define', text: prompt, options: {} },
  }),
  openAi: (name, model) => ({
    name,
    type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
    typeVersion: 1.2,
    credentials: { openAiApi: { id: 'cred-openai', name: 'OpenAI' } },
    parameters: { model: { __rl: true, mode: 'list', value: model }, options: {} },
  }),
  anthropic: (name, model) => ({
    name,
    type: '@n8n/n8n-nodes-langchain.lmChatAnthropic',
    typeVersion: 1.3,
    credentials: { anthropicApi: { id: 'cred-anthropic', name: 'Anthropic' } },
    parameters: { model: { __rl: true, mode: 'list', value: model }, options: {} },
  }),
};

/**
 * Un workflow n8n complet à partir d'une chaîne de nœuds : `flow` décrit les
 * liens (`['A', 'B']`, `['A', 'C', 1]` pour la sortie 1, `['M', 'Agent', 'ai']`
 * pour un sous-nœud de modèle). Les positions sont posées en grille.
 */
export function workflow({ id, name, tags = [], active = false, nodes, flow, updatedAt }) {
  const placed = nodes.map((node, index) => ({
    id: uuid(`${id}-${node.name}`),
    position: [index * 240, node.type.includes('lmChat') ? 220 : 0],
    ...node,
  }));
  const connections = {};
  for (const [from, to, output = 0] of flow) {
    const kind = output === 'ai' ? 'ai_languageModel' : 'main';
    const index = output === 'ai' ? 0 : output;
    connections[from] ??= {};
    connections[from][kind] ??= [];
    while (connections[from][kind].length <= index) connections[from][kind].push([]);
    connections[from][kind][index].push({ node: to, type: kind, index: 0 });
  }
  return {
    id,
    name,
    active,
    isArchived: false,
    nodes: placed,
    connections,
    settings: { executionOrder: 'v1' },
    tags: tags.map((tag) => ({ id: uuid(`tag-${tag}`).slice(0, 16), name: tag })),
    createdAt: '2026-06-02T09:00:00.000Z',
    updatedAt: updatedAt ?? '2026-09-10T09:00:00.000Z',
    versionId: uuid(`${id}-${updatedAt ?? ''}`),
  };
}
