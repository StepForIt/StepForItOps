import { describe, expect, it } from 'vitest';
import { PathHolder, findPathConflicts } from '../src/domain/n8n/webhook-path-conflicts';
import { EnvName } from '../src/domain/env';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';

const holder = (
  id: string,
  name: string,
  path: string,
  { active = false, env = null as EnvName | null } = {},
): PathHolder => ({
  id,
  name,
  active,
  env,
  raw: {
    name,
    nodes: [
      { id: 'w', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: { path } },
    ],
    connections: {},
  } as N8nWorkflow,
});

describe('findPathConflicts', () => {
  it('ignore un path que personne ne dispute', () => {
    const report = findPathConflicts([holder('1', 'A', 'commande'), holder('2', 'B', 'facture')]);
    expect(report.fixes).toEqual([]);
    expect(report.standoffs).toEqual([]);
  });

  it('laisse la prod garder l’URL et suffixe la copie dev', () => {
    const report = findPathConflicts([
      holder('1', 'FORM (1.2.3)', 'commande', { active: true, env: 'prod' }),
      holder('2', 'FORM (1.2.3) - DEV', 'commande', { env: 'dev' }),
    ]);
    expect(report.standoffs).toEqual([]);
    expect(report.fixes).toEqual([
      {
        workflowId: '2',
        workflowName: 'FORM (1.2.3) - DEV',
        env: 'dev',
        node: 'Webhook',
        from: 'commande',
        to: 'commande-dev',
        keeper: 'FORM (1.2.3)',
      },
    ]);
  });

  it('à défaut d’exemplaire prod, c’est l’actif qui garde l’URL', () => {
    const report = findPathConflicts([
      holder('1', 'Sync', 'commande', { active: true }),
      holder('2', 'Sync - PREPROD', 'commande', { env: 'preprod' }),
    ]);
    expect(report.fixes.map((f) => [f.workflowId, f.to, f.keeper])).toEqual([
      ['2', 'commande-preprod', 'Sync'],
    ]);
  });

  it('ne tranche pas quand aucun exemplaire n’est prod ni actif', () => {
    const report = findPathConflicts([
      holder('1', 'A - DEV', 'commande', { env: 'dev' }),
      holder('2', 'B - DEV', 'commande', { env: 'dev' }),
    ]);
    expect(report.fixes).toEqual([]);
    expect(report.standoffs[0].reason).toMatch(/aucun exemplaire en env d’URL publique ni actif/);
  });

  it('signale une copie dont l’env est indéterminé au lieu de deviner', () => {
    const report = findPathConflicts([
      holder('1', 'FORM', 'commande', { active: true, env: 'prod' }),
      holder('2', 'FORM (copie)', 'commande'),
    ]);
    expect(report.fixes).toEqual([]);
    expect(report.standoffs[0].reason).toMatch(/env indéterminé/);
  });

  it('refuse de déplacer deux copies du même env vers le même path', () => {
    const report = findPathConflicts([
      holder('1', 'FORM', 'commande', { active: true, env: 'prod' }),
      holder('2', 'FORM - DEV', 'commande', { env: 'dev' }),
      holder('3', 'FORM (bis) - DEV', 'commande', { env: 'dev' }),
    ]);
    expect(report.fixes).toEqual([]);
    expect(report.standoffs[0].reason).toMatch(/plusieurs copies viseraient \/commande-dev/);
  });

  it('traite chaque path séparément', () => {
    const report = findPathConflicts([
      holder('1', 'A', 'commande', { active: true, env: 'prod' }),
      holder('2', 'A - DEV', 'commande', { env: 'dev' }),
      holder('3', 'B', 'facture', { active: true, env: 'prod' }),
      holder('4', 'B - PREPROD', 'facture', { env: 'preprod' }),
    ]);
    expect(report.fixes.map((f) => f.to).sort()).toEqual(['commande-dev', 'facture-preprod']);
  });
});

describe('findPathConflicts (Form Trigger)', () => {
  const formHolder = (
    id: string,
    name: string,
    parameters: Record<string, unknown>,
    webhookId: string,
    { active = false, env = null as EnvName | null } = {},
  ): PathHolder => ({
    id,
    name,
    active,
    env,
    raw: {
      name,
      nodes: [
        {
          id: 'f',
          name: 'On form submission',
          type: 'n8n-nodes-base.formTrigger',
          typeVersion: 2.3,
          position: [0, 0],
          parameters,
          webhookId,
        },
      ],
      connections: {},
    } as N8nWorkflow,
  });

  it('voit un path rangé dans les options et propose la copie suffixée', () => {
    const report = findPathConflicts([
      formHolder('1', 'Contact', { options: { path: 'contact' } }, 'a', { active: true, env: 'prod' }),
      formHolder('2', 'Contact - DEV', { options: { path: 'contact' } }, 'b', { env: 'dev' }),
    ]);
    expect(report.fixes.map((f) => [f.workflowId, f.from, f.to])).toEqual([['2', 'contact', 'contact-dev']]);
  });

  it('suffixe la copie d’un formulaire servi par son uuid, sans toucher l’uuid', () => {
    const report = findPathConflicts([
      formHolder('1', 'Contact', {}, 'meme-id', { active: true, env: 'prod' }),
      formHolder('2', 'Contact - DEV', {}, 'meme-id', { env: 'dev' }),
    ]);
    expect(report.standoffs).toEqual([]);
    expect(report.fixes.map((f) => [f.workflowId, f.from, f.to, f.keeper])).toEqual([
      ['2', 'meme-id', 'meme-id-dev', 'Contact'],
    ]);
  });

  it('signale sans le corriger un point d’entrée qui ne sait pas porter de path', () => {
    const chat = (id: string, name: string, env: EnvName, active: boolean): PathHolder => ({
      id,
      name,
      active,
      env,
      raw: {
        name,
        nodes: [
          {
            id: 'c',
            name: 'Chat',
            type: '@n8n/n8n-nodes-langchain.chatTrigger',
            position: [0, 0],
            parameters: {},
            webhookId: 'meme-id',
          },
        ],
        connections: {},
      } as N8nWorkflow,
    });
    const report = findPathConflicts([chat('1', 'Bot', 'prod', true), chat('2', 'Bot - DEV', 'dev', false)]);
    expect(report.fixes).toEqual([]);
    expect(report.standoffs).toEqual([
      { path: 'meme-id', workflows: ['Bot - DEV'], reason: expect.stringContaining('recrée le nœud') },
    ]);
  });
});
