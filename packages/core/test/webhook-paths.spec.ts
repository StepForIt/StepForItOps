import { describe, expect, it } from 'vitest';
import { alignWebhookPaths, applyEnvWebhookPaths, envWebhookPath } from '../src/domain/n8n/webhook-paths';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';
import { normalizeEnvs } from '../src/domain/env';

const workflow = (path: unknown): N8nWorkflow => ({
  name: 'FORM -> Airtable',
  nodes: [
    {
      id: '1',
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      position: [0, 0],
      parameters: { path },
      webhookId: 'ancien',
    },
    { id: '2', name: 'Airtable', type: 'n8n-nodes-base.airtable', position: [1, 0], parameters: {} },
  ],
  connections: {},
});

describe('envWebhookPath', () => {
  it('suffixe le path', () => {
    expect(envWebhookPath('commande', 'dev')).toBe('commande-dev');
  });

  it('remplace un suffixe d’env existant au lieu de l’empiler', () => {
    expect(envWebhookPath('commande-preprod', 'dev')).toBe('commande-dev');
    expect(envWebhookPath('commande-dev', 'dev')).toBe('commande-dev');
  });

  it('suit la case « URL publique » de l’env, pas son nom', () => {
    const envs = normalizeEnvs([
      { id: 'dev' },
      { id: 'recette', canonicalWebhookPath: true },
      { id: 'prod', canonicalWebhookPath: false },
    ]);
    expect(envWebhookPath('commande-dev', 'recette', envs)).toBe('commande');
    expect(envWebhookPath('commande', 'prod', envs)).toBe('commande-prod');
  });

  it('retire le suffixe pour la prod : c’est elle qui porte l’URL publique', () => {
    expect(envWebhookPath('commande-dev', 'prod')).toBe('commande');
    expect(envWebhookPath('commande', 'prod')).toBe('commande');
    expect(envWebhookPath('commande-dev/:id', 'prod')).toBe('commande/:id');
  });

  it('suffixe le premier segment, pas le paramètre d’URL', () => {
    expect(envWebhookPath('commande/:id', 'preprod')).toBe('commande-preprod/:id');
  });

  it('ignore le slash de tête', () => {
    expect(envWebhookPath('/commande', 'dev')).toBe('commande-dev');
  });
});

describe('applyEnvWebhookPaths', () => {
  it('réécrit le path des nœuds Webhook et renouvelle leur webhookId', () => {
    const result = applyEnvWebhookPaths(workflow('commande'), 'dev', () => 'neuf');
    const [webhook] = result.workflow.nodes;
    expect(webhook.parameters?.path).toBe('commande-dev');
    expect(webhook.webhookId).toBe('neuf');
    expect(result.changes).toEqual([{ node: 'Webhook', from: 'commande', to: 'commande-dev' }]);
  });

  it('ne touche pas les autres nœuds', () => {
    const result = applyEnvWebhookPaths(workflow('commande'), 'dev');
    expect(result.workflow.nodes[1]).toEqual(workflow('commande').nodes[1]);
  });

  it('laisse le workflow intact quand le path est déjà celui de l’env', () => {
    const result = applyEnvWebhookPaths(workflow('commande-dev'), 'dev', () => 'neuf');
    expect(result.changes).toEqual([]);
    expect(result.workflow.nodes[0].webhookId).toBe('ancien');
  });

  it('couvre le Form Trigger et tout trigger porteur d’un webhookId', () => {
    const form: N8nWorkflow = {
      name: 'Formulaire contact',
      nodes: [
        {
          id: '1',
          name: 'On form submission',
          type: 'n8n-nodes-base.formTrigger',
          position: [0, 0],
          parameters: { path: 'contact', formTitle: 'Contact' },
          webhookId: 'ancien',
        },
        {
          id: '2',
          name: 'Page 2',
          type: 'n8n-nodes-base.form',
          position: [1, 0],
          parameters: { operation: 'page' },
        },
      ],
      connections: {},
    };
    const result = applyEnvWebhookPaths(form, 'dev', () => 'neuf');
    expect(result.changes).toEqual([{ node: 'On form submission', from: 'contact', to: 'contact-dev' }]);
    // Un formulaire garde son uuid : c'est le path qui distingue les envs.
    expect(result.workflow.nodes[0].webhookId).toBe('ancien');
    // La page suivante n'a pas de path propre : rien à réserver, rien à changer.
    expect(result.workflow.nodes[1]).toEqual(form.nodes[1]);
  });

  it('ignore un path absent ou vide', () => {
    expect(applyEnvWebhookPaths(workflow(undefined), 'dev').changes).toEqual([]);
    expect(applyEnvWebhookPaths(workflow('   '), 'dev').changes).toEqual([]);
  });
});

describe('alignWebhookPaths (promotion)', () => {
  const cible: N8nWorkflow = {
    name: 'FORM -> Airtable',
    nodes: [
      {
        id: '1',
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        position: [0, 0],
        parameters: { path: 'commande-historique' },
        webhookId: 'celui-de-la-cible',
      },
    ],
    connections: {},
  };

  it('reprend le path de la cible : son URL est déjà en circulation', () => {
    const result = alignWebhookPaths(workflow('commande-dev'), { target: cible, env: 'prod' });
    expect(result.workflow.nodes[0].parameters?.path).toBe('commande-historique');
    expect(result.workflow.nodes[0].webhookId).toBe('celui-de-la-cible');
    expect(result.preserved).toEqual([{ node: 'Webhook', from: 'commande-dev', to: 'commande-historique' }]);
    expect(result.changes).toEqual([]);
  });

  it('apparie par nom quand l’id diffère', () => {
    const renomme = { ...cible, nodes: [{ ...cible.nodes[0], id: 'autre' }] };
    const result = alignWebhookPaths(workflow('commande-dev'), { target: renomme, env: 'prod' });
    expect(result.preserved).toHaveLength(1);
  });

  it('suffixe les triggers sans contrepartie sur la cible', () => {
    const vide: N8nWorkflow = { name: 'x', nodes: [], connections: {} };
    const result = alignWebhookPaths(workflow('commande'), { target: vide, env: 'dev' });
    expect(result.preserved).toEqual([]);
    expect(result.changes).toEqual([{ node: 'Webhook', from: 'commande', to: 'commande-dev' }]);
  });

  it('ne touche à rien sans cible ni env (promotion vers une autre instance)', () => {
    const result = alignWebhookPaths(workflow('commande'), {});
    expect(result.preserved).toEqual([]);
    expect(result.changes).toEqual([]);
    expect(result.workflow.nodes[0].parameters?.path).toBe('commande');
  });
});

/**
 * Le Form Trigger range son path au premier niveau jusqu'à la 2.1, dans ses options
 * à partir de la 2.2 — où il devient facultatif : sans lui, l'URL est
 * `/form/<webhookId>`. Un même formulaire garde son uuid d'un env à l'autre, et
 * l'env se lit dans le suffixe : `/form/<uuid>-dev`, `-preprod`, et `/form/<uuid>`
 * nu pour l'env à URL publique.
 */
describe('alignWebhookPaths (Form Trigger)', () => {
  const UUID = '8b13374e-3132-48f2-b9cc-5a55590bfb8f';
  const form = (parameters: Record<string, unknown>, webhookId: string, typeVersion = 2.5): N8nWorkflow => ({
    name: 'Contact',
    nodes: [
      {
        id: 'f',
        name: 'On form submission',
        type: 'n8n-nodes-base.formTrigger',
        typeVersion,
        position: [0, 0],
        parameters: { formTitle: 'Contact', ...parameters },
        webhookId,
      },
    ],
    connections: {},
  });
  const freshId = () => 'jamais-utilise';
  const node = (result: { workflow: N8nWorkflow }) => result.workflow.nodes[0];

  it('dev servie par son uuid → preprod : même uuid, suffixé', () => {
    const result = alignWebhookPaths(form({}, UUID), { env: 'preprod', freshId });
    expect(node(result).webhookId).toBe(UUID);
    expect(node(result).parameters?.['options']).toEqual({ path: `${UUID}-preprod` });
    expect(result.changes).toEqual([{ node: 'On form submission', from: UUID, to: `${UUID}-preprod` }]);
  });

  it('dev déjà suffixée → preprod : le suffixe est remplacé, l’uuid gardé', () => {
    const result = alignWebhookPaths(form({ options: { path: `${UUID}-dev` } }, UUID), {
      env: 'preprod',
      freshId,
    });
    expect(node(result).webhookId).toBe(UUID);
    expect(node(result).parameters?.['options']).toEqual({ path: `${UUID}-preprod` });
  });

  it('preprod → prod sans contrepartie : l’uuid nu, sans path', () => {
    const result = alignWebhookPaths(form({ options: { path: `${UUID}-preprod` } }, UUID), {
      env: 'prod',
      freshId,
    });
    expect(node(result).webhookId).toBe(UUID);
    expect(node(result).parameters).toEqual({ formTitle: 'Contact', options: {} });
    expect(result.changes).toEqual([{ node: 'On form submission', from: `${UUID}-preprod`, to: UUID }]);
  });

  it('vers l’env à URL publique, un formulaire déjà nu reste tel quel', () => {
    const result = alignWebhookPaths(form({}, UUID), { env: 'prod', freshId });
    expect(node(result)).toEqual(form({}, UUID).nodes[0]);
    expect(result.changes).toEqual([]);
  });

  it('suffixe un path choisi à la main, sans toucher l’uuid', () => {
    const result = alignWebhookPaths(form({ options: { path: 'contact' } }, UUID), { env: 'dev', freshId });
    expect(node(result).parameters?.['options']).toEqual({ path: 'contact-dev' });
    expect(node(result).webhookId).toBe(UUID);
  });

  it('suffixe un path au premier niveau (2.1 et moins)', () => {
    const result = alignWebhookPaths(form({ path: 'contact' }, UUID, 2.1), { env: 'dev' });
    expect(node(result).parameters?.['path']).toBe('contact-dev');
  });

  it('prod pré-existante : reprend son uuid, l’URL publiée ne bouge pas', () => {
    const result = alignWebhookPaths(form({ options: { path: `${UUID}-preprod` } }, UUID), {
      target: form({}, 'uuid-de-la-prod'),
      env: 'prod',
      freshId,
    });
    expect(node(result).webhookId).toBe('uuid-de-la-prod');
    expect(node(result).parameters).toEqual({ formTitle: 'Contact', options: {} });
    expect(result.preserved).toEqual([
      { node: 'On form submission', from: `${UUID}-preprod`, to: 'uuid-de-la-prod' },
    ]);
    expect(result.changes).toEqual([]);
  });

  it('cible avec un path à elle : reprend path et uuid', () => {
    const result = alignWebhookPaths(form({}, UUID), {
      target: form({ options: { path: 'contact' } }, 'uuid-de-la-prod'),
      env: 'prod',
    });
    expect(node(result).parameters?.['options']).toEqual({ path: 'contact' });
    expect(node(result).webhookId).toBe('uuid-de-la-prod');
  });

  it('ne réécrit rien quand la cible sert déjà la même URL', () => {
    const result = alignWebhookPaths(form({}, UUID), { target: form({}, UUID), env: 'prod' });
    expect(result.preserved).toEqual([]);
    expect(result.changes).toEqual([]);
  });

  it('renouvelle l’uuid d’un point d’entrée qui ne sait pas porter de path (Chat Trigger)', () => {
    const chat: N8nWorkflow = {
      name: 'Chat',
      nodes: [
        {
          id: 'c',
          name: 'When chat message received',
          type: '@n8n/n8n-nodes-langchain.chatTrigger',
          position: [0, 0],
          parameters: {},
          webhookId: 'id-source',
        },
      ],
      connections: {},
    };
    const result = alignWebhookPaths(chat, { env: 'dev', freshId: () => 'neuf' });
    expect(node(result).webhookId).toBe('neuf');
    expect(result.changes).toEqual([{ node: 'When chat message received', from: 'id-source', to: 'neuf' }]);
  });
});
