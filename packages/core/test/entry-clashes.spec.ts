import { describe, expect, it } from 'vitest';
import { findEntryClashes } from '../src/domain/n8n/entry-clashes';
import { PathHolder } from '../src/domain/n8n/webhook-path-conflicts';
import { EnvName } from '../src/domain/env';
import { N8nNode, N8nWorkflow } from '../src/domain/n8n/workflow.types';

const UUID = '8b13374e-3132-48f2-b9cc-5a55590bfb8f';

const formNode = (
  parameters: Record<string, unknown>,
  webhookId = UUID,
  extra: Partial<N8nNode> = {},
): N8nNode => ({
  id: 'f',
  name: 'On form submission1',
  type: 'n8n-nodes-base.formTrigger',
  typeVersion: 2.5,
  position: [0, 0],
  parameters: { formTitle: 'Ajouter manuellement', ...parameters },
  webhookId,
  ...extra,
});

const workflow = (name: string, nodes: N8nNode[]): N8nWorkflow => ({ name, nodes, connections: {} });

const holder = (
  id: string,
  name: string,
  nodes: N8nNode[],
  { active = true, env = 'dev' as EnvName | null } = {},
): PathHolder => ({ id, name, active, env, raw: workflow(name, nodes) });

describe('findEntryClashes', () => {
  it('voit la dev qui tient déjà l’uuid nu que la prod va recevoir', () => {
    const candidate = workflow('FORM - PROD', [formNode({ options: {} })]);
    const clashes = findEntryClashes(candidate, [holder('d', 'FORM - DEV', [formNode({ options: {} })])]);
    expect(clashes).toEqual([
      {
        node: 'On form submission1',
        url: UUID,
        holderId: 'd',
        holderName: 'FORM - DEV',
        holderActive: true,
        holderNode: 'On form submission1',
        move: `${UUID}-dev`,
      },
    ]);
  });

  it('propose le suffixe de l’env du détenteur sur un path choisi à la main', () => {
    const candidate = workflow('FORM - PROD', [formNode({ options: { path: 'contact' } })]);
    const clashes = findEntryClashes(candidate, [
      holder('d', 'FORM - DEV', [formNode({ options: { path: 'contact' } }, 'autre')], { active: false }),
    ]);
    expect(clashes.map((c) => [c.move, c.holderActive])).toEqual([['contact-dev', false]]);
  });

  it('couvre le Webhook comme le formulaire', () => {
    const hook = (path: string): N8nNode => ({
      id: 'w',
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      position: [0, 0],
      parameters: { path },
      webhookId: 'x',
    });
    const clashes = findEntryClashes(workflow('C - PROD', [hook('commande')]), [
      holder('d', 'C - DEV', [hook('commande')]),
    ]);
    expect(clashes.map((c) => c.move)).toEqual(['commande-dev']);
  });

  it('ne propose rien quand le détenteur n’a pas d’env ou tient l’URL publique', () => {
    const candidate = workflow('FORM - PREPROD', [formNode({ options: { path: 'contact-preprod' } })]);
    const sansEnv = holder('a', 'Vieux formulaire', [formNode({ options: { path: 'contact-preprod' } })], {
      env: null,
    });
    const memeEnv = holder('b', 'Autre - PREPROD', [formNode({ options: { path: 'contact-preprod' } })], {
      env: 'preprod',
    });
    expect(findEntryClashes(candidate, [sansEnv, memeEnv]).map((c) => [c.holderName, c.move])).toEqual([
      ['Vieux formulaire', null],
      ['Autre - PREPROD', null],
    ]);
  });

  it('ne propose rien pour un trigger qui ne sait pas porter de path', () => {
    const chat: N8nNode = {
      id: 'c',
      name: 'Chat',
      type: '@n8n/n8n-nodes-langchain.chatTrigger',
      position: [0, 0],
      parameters: {},
      webhookId: 'meme',
    };
    expect(
      findEntryClashes(workflow('Bot - PROD', [chat]), [holder('d', 'Bot - DEV', [chat])])[0].move,
    ).toBeNull();
  });

  it('ignore les nœuds désactivés, des deux côtés : n8n ne les enregistre pas', () => {
    const off = formNode({ options: {} }, UUID, { disabled: true });
    expect(findEntryClashes(workflow('P', [off]), [holder('d', 'D', [formNode({ options: {} })])])).toEqual(
      [],
    );
    expect(findEntryClashes(workflow('P', [formNode({ options: {} })]), [holder('d', 'D', [off])])).toEqual(
      [],
    );
  });

  it('ne signale rien quand les URLs diffèrent', () => {
    const candidate = workflow('FORM - PROD', [formNode({ options: {} })]);
    const dev = holder('d', 'FORM - DEV', [formNode({ options: { path: `${UUID}-dev` } })]);
    expect(findEntryClashes(candidate, [dev])).toEqual([]);
  });
});
