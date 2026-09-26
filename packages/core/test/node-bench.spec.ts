import { describe, expect, it } from 'vitest';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';
import {
  benchInputName,
  BENCH_TAG,
  benchWorkflowName,
  benchImpacts,
  buildNodeBenchWorkflow,
  describeNodeTarget,
  evaluateBenchGate,
  planNodeBench,
  readBenchOutcome,
} from '../src/domain/n8n/node-bench';

let counter = 0;
const newId = () => `id-${++counter}`;

const workflow: N8nWorkflow = {
  name: 'Facturation',
  nodes: [
    { name: 'Webhook', type: 'n8n-nodes-base.webhook', parameters: {} },
    { name: 'Récupérer le client', type: 'n8n-nodes-base.airtable', parameters: {} },
    {
      name: 'Envoyer la facture',
      type: 'n8n-nodes-base.gmail',
      parameters: {
        sendTo: "={{ $('Récupérer le client').item.json.email }}",
        message: '={{ $json.total }}',
      },
      credentials: { gmailOAuth2: { id: 'cred-1', name: 'Gmail' } },
    },
    { name: 'Archiver', type: 'n8n-nodes-base.noOp', parameters: {} },
  ],
  connections: {
    Webhook: { main: [[{ node: 'Récupérer le client', type: 'main', index: 0 }]] },
    'Récupérer le client': { main: [[{ node: 'Envoyer la facture', type: 'main', index: 0 }]] },
    'Envoyer la facture': { main: [[{ node: 'Archiver', type: 'main', index: 0 }]] },
  },
};

describe('planNodeBench', () => {
  it('réunit le parent d’entrée et les nœuds cités par les expressions', () => {
    const plan = planNodeBench(workflow, 'Envoyer la facture');
    // Ici les deux sont le même nœud : une seule simulation, qui joue les deux rôles.
    expect(plan.feeds).toEqual([
      {
        nodeName: 'Récupérer le client',
        role: 'both',
        inputIndex: 0,
        inputType: 'main',
        citedAt: ['$.parameters.sendTo'],
      },
    ]);
    expect(plan.blocked).toBe(false);
  });

  it('invente une entrée quand le nœud n’a aucun parent', () => {
    const orphan: N8nWorkflow = {
      name: 'X',
      nodes: [{ name: 'Seul', type: 'n8n-nodes-base.set', parameters: {} }],
      connections: {},
    };
    expect(planNodeBench(orphan, 'Seul').feeds).toEqual([
      { nodeName: benchInputName(), role: 'input', inputIndex: 0, inputType: 'main', citedAt: [] },
    ]);
  });

  it('ignore les paramètres inertes : pas de simulation pour du champ mort', () => {
    const inert: N8nWorkflow = {
      name: 'X',
      nodes: [
        { name: 'Source', type: 'n8n-nodes-base.set', parameters: {} },
        {
          name: 'Écrire',
          type: 'n8n-nodes-base.airtable',
          parameters: {
            columns: {
              mappingMode: 'autoMapInputData',
              value: { email: "={{ $('Ancien nœud').item.json.email }}" },
            },
          },
        },
      ],
      connections: { Source: { main: [[{ node: 'Écrire', type: 'main', index: 0 }]] } },
    };
    const plan = planNodeBench(inert, 'Écrire');
    expect(plan.feeds.map((f) => f.nodeName)).toEqual(['Source']);
    expect(plan.issues).toEqual([]);
  });

  it('refuse un déclencheur et une note', () => {
    expect(planNodeBench(workflow, 'Webhook').blocked).toBe(true);
    expect(planNodeBench(workflow, 'Webhook').issues[0].code).toBe('trigger-node');
  });

  it('avertit sur une entrée binaire et sur une ref absente', () => {
    const binary: N8nWorkflow = {
      name: 'X',
      nodes: [
        {
          name: 'Envoyer le fichier',
          type: 'n8n-nodes-base.httpRequest',
          parameters: {
            sendBody: true,
            contentType: 'binaryData',
            inputDataFieldName: 'data',
            url: "={{ $('Disparu').item.json.url }}",
          },
        },
      ],
      connections: {},
    };
    const codes = planNodeBench(binary, 'Envoyer le fichier').issues.map((i) => i.code);
    expect(codes).toContain('binary-input');
    expect(codes).toContain('missing-ref');
  });

  it('signale les sous-nœuds, qui s’exécuteront pour de vrai', () => {
    const agent: N8nWorkflow = {
      name: 'X',
      nodes: [
        { name: 'Entrée', type: 'n8n-nodes-base.set', parameters: {} },
        { name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent', parameters: {} },
        { name: 'Modèle', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', parameters: {} },
      ],
      connections: {
        Entrée: { main: [[{ node: 'Agent', type: 'main', index: 0 }]] },
        Modèle: { ai_languageModel: [[{ node: 'Agent', type: 'ai_languageModel', index: 0 }]] },
      },
    };
    const plan = planNodeBench(agent, 'Agent');
    expect(plan.subNodes).toEqual(['Modèle']);
    expect(plan.issues.map((i) => i.code)).toContain('sub-nodes-run');
  });
});

describe('buildNodeBenchWorkflow', () => {
  const bench = buildNodeBenchWorkflow({
    workflow,
    nodeName: 'Envoyer la facture',
    webhookPath: 'nwm-bench-1',
    feeds: { 'Récupérer le client': [{ email: 'a@b.c' }, { email: 'd@e.f' }] },
    newId,
  });

  it('nomme et étiquette le banc pour qu’il se retrouve et s’exclue', () => {
    expect(bench.name).toBe(benchWorkflowName('Facturation', 'Envoyer la facture'));
    expect(bench.tags).toEqual([{ name: BENCH_TAG }]);
    expect(bench.active).toBe(false);
  });

  it('n’embarque que le nécessaire : webhook, simulés, nœud testé, réponse', () => {
    expect(bench.nodes.map((n) => n.name)).toEqual([
      'Lancer le banc',
      'Récupérer le client',
      'Envoyer la facture',
      'Rendre le résultat',
    ]);
  });

  it('sert la donnée figée sous le nom d’origine, pour que $() résolve', () => {
    const feed = bench.nodes.find((n) => n.name === 'Récupérer le client')!;
    expect(feed.type).toBe('n8n-nodes-base.code');
    expect(feed.parameters?.jsCode).toContain('"email": "a@b.c"');
    expect(feed.parameters?.jsCode).toContain('"email": "d@e.f"');
  });

  it('chaîne webhook → simulés → nœud testé → réponse', () => {
    expect(bench.connections).toEqual({
      'Lancer le banc': { main: [[{ node: 'Récupérer le client', type: 'main', index: 0 }]] },
      'Récupérer le client': { main: [[{ node: 'Envoyer la facture', type: 'main', index: 0 }]] },
      'Envoyer la facture': { main: [[{ node: 'Rendre le résultat', type: 'main', index: 0 }]] },
    });
  });

  it('recopie le nœud tel quel, credentials compris, et rend l’échec lisible', () => {
    const tested = bench.nodes.find((n) => n.name === 'Envoyer la facture')!;
    expect(tested.credentials).toEqual({ gmailOAuth2: { id: 'cred-1', name: 'Gmail' } });
    expect(tested.parameters?.sendTo).toBe("={{ $('Récupérer le client').item.json.email }}");
    expect(tested.onError).toBe('continueRegularOutput');
    expect(tested.alwaysOutputData).toBe(true);
  });

  it('n’alerte personne : le workflow d’erreur ne suit pas', () => {
    const withError = buildNodeBenchWorkflow({
      workflow: { ...workflow, settings: { errorWorkflow: 'wf-9', timezone: 'Europe/Paris' } },
      nodeName: 'Envoyer la facture',
      webhookPath: 'p',
      feeds: {},
      newId,
    });
    expect(withError.settings).toEqual({ timezone: 'Europe/Paris' });
  });

  it('chaîne les simulés cités AVANT celui qui alimente l’entrée', () => {
    const twoParents: N8nWorkflow = {
      name: 'X',
      nodes: [
        { name: 'Client', type: 'n8n-nodes-base.set', parameters: {} },
        { name: 'Lignes', type: 'n8n-nodes-base.set', parameters: {} },
        {
          name: 'Composer',
          type: 'n8n-nodes-base.set',
          parameters: { value: "={{ $('Client').item.json.nom }}" },
        },
      ],
      connections: { Lignes: { main: [[{ node: 'Composer', type: 'main', index: 0 }]] } },
    };
    const built = buildNodeBenchWorkflow({
      workflow: twoParents,
      nodeName: 'Composer',
      webhookPath: 'p',
      feeds: {},
      newId,
    });
    expect(built.nodes.map((n) => n.name)).toEqual([
      'Lancer le banc',
      'Client',
      'Lignes',
      'Composer',
      'Rendre le résultat',
    ]);
    expect(built.connections['Client'].main[0][0].node).toBe('Lignes');
    expect(built.connections['Lignes'].main[0][0].node).toBe('Composer');
  });

  it('recopie les sous-nœuds avec leur branchement d’origine', () => {
    const agent: N8nWorkflow = {
      name: 'X',
      nodes: [
        { name: 'Entrée', type: 'n8n-nodes-base.set', parameters: {} },
        { name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent', parameters: {} },
        { name: 'Modèle', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', parameters: {} },
      ],
      connections: {
        Entrée: { main: [[{ node: 'Agent', type: 'main', index: 0 }]] },
        Modèle: { ai_languageModel: [[{ node: 'Agent', type: 'ai_languageModel', index: 0 }]] },
      },
    };
    const built = buildNodeBenchWorkflow({
      workflow: agent,
      nodeName: 'Agent',
      webhookPath: 'p',
      feeds: {},
      newId,
    });
    expect(built.nodes.map((n) => n.name)).toContain('Modèle');
    expect(built.connections['Modèle']).toEqual({
      ai_languageModel: [[{ node: 'Agent', type: 'ai_languageModel', index: 0 }]],
    });
  });

  it('refuse de bâtir un banc pour un déclencheur', () => {
    expect(() =>
      buildNodeBenchWorkflow({ workflow, nodeName: 'Webhook', webhookPath: 'p', feeds: {}, newId }),
    ).toThrow(/Banc impossible/);
  });
});

describe('impact et porte', () => {
  const httpNode = {
    name: 'Créer le lead',
    type: 'n8n-nodes-base.httpRequest',
    parameters: { method: 'POST', url: 'https://crm.exemple.fr/leads' },
    credentials: { httpHeaderAuth: { id: 'c1', name: 'CRM prod' } },
  };
  const prodWorkflow: N8nWorkflow = {
    name: 'Leads - PROD',
    nodes: [{ name: 'Source', type: 'n8n-nodes-base.set', parameters: {} }, httpNode],
    connections: { Source: { main: [[{ node: 'Créer le lead', type: 'main', index: 0 }]] } },
  };

  it('dit ce que le nœud vise, pas seulement ce qu’il fait', () => {
    expect(describeNodeTarget(httpNode)).toBe('POST https://crm.exemple.fr/leads');
    expect(
      describeNodeTarget({
        name: 'X',
        type: 'n8n-nodes-base.airtable',
        parameters: {
          resource: 'record',
          operation: 'create',
          base: { __rl: true, value: 'appX', cachedResultName: 'CRM' },
        },
      }),
    ).toBe('record · create → CRM');
  });

  it('ne compte que ce qui s’exécutera vraiment', () => {
    const impacts = benchImpacts(prodWorkflow, planNodeBench(prodWorkflow, 'Créer le lead'));
    expect(impacts).toEqual([
      {
        nodeName: 'Créer le lead',
        kind: 'http-write',
        reason: 'appel HTTP POST',
        target: 'POST https://crm.exemple.fr/leads',
        credentials: ['CRM prod'],
        subNode: false,
      },
    ]);
  });

  it('bloque en prod, montre en dev, cède à un contournement explicite', () => {
    const impacts = benchImpacts(prodWorkflow, planNodeBench(prodWorkflow, 'Créer le lead'));
    expect(evaluateBenchGate(impacts, { env: 'prod', active: true }).blocked).toBe(true);
    expect(evaluateBenchGate(impacts, { env: 'dev', active: true }).blocked).toBe(false);
    expect(evaluateBenchGate(impacts, { env: 'dev', active: true }).reasons[0]).toContain('crm.exemple.fr');
    expect(evaluateBenchGate(impacts, { env: 'prod', active: true, force: true }).blocked).toBe(false);
  });

  it('sans env déclaré, un workflow ACTIF compte comme de la prod', () => {
    const impacts = benchImpacts(prodWorkflow, planNodeBench(prodWorkflow, 'Créer le lead'));
    expect(evaluateBenchGate(impacts, { env: null, active: true }).blocked).toBe(true);
    expect(evaluateBenchGate(impacts, { env: null, active: false }).blocked).toBe(false);
  });

  it('un nœud qui ne sort rien ne déclenche aucune porte', () => {
    const read: N8nWorkflow = {
      name: 'X - PROD',
      nodes: [{ name: 'Lire', type: 'n8n-nodes-base.airtable', parameters: { operation: 'search' } }],
      connections: {},
    };
    const impacts = benchImpacts(read, planNodeBench(read, 'Lire'));
    expect(impacts[0].kind).toBeUndefined();
    expect(evaluateBenchGate(impacts, { env: 'prod', active: true })).toEqual({
      blocked: false,
      reasons: [],
    });
  });
});

describe('readBenchOutcome', () => {
  const execution = (runData: unknown, extra: Record<string, unknown> = {}) => ({
    data: { resultData: { runData, ...extra } },
  });

  it('rend les items du nœud testé', () => {
    const outcome = readBenchOutcome(
      execution({ 'Envoyer la facture': [{ data: { main: [[{ json: { id: 1 } }, { json: { id: 2 } }]] } }] }),
      'Envoyer la facture',
    );
    expect(outcome).toEqual({ status: 'ok', items: [{ id: 1 }, { id: 2 }] });
  });

  it('voit l’échec rangé dans l’item par continueRegularOutput', () => {
    const outcome = readBenchOutcome(
      execution({
        'Envoyer la facture': [
          { data: { main: [[{ json: { error: { message: 'Invalid credentials' } } }]] } },
        ],
      }),
      'Envoyer la facture',
    );
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toBe('Invalid credentials');
  });

  it('voit aussi l’erreur portée par le run', () => {
    const outcome = readBenchOutcome(
      execution({ 'Envoyer la facture': [{ error: { message: 'ECONNREFUSED' }, data: { main: [[]] } }] }),
      'Envoyer la facture',
    );
    expect(outcome).toEqual({ status: 'failed', items: [], error: 'ECONNREFUSED' });
  });

  it('distingue « pas exécuté » d’un succès vide', () => {
    expect(readBenchOutcome(execution({}), 'Envoyer la facture').status).toBe('unknown');
    expect(
      readBenchOutcome(
        execution({ Autre: [] }, { error: { message: 'Workflow arrêté' } }),
        'Envoyer la facture',
      ),
    ).toEqual({ status: 'failed', items: [], error: 'Workflow arrêté' });
  });

  it('lit une exécution dont `data` arrive en chaîne JSON', () => {
    const outcome = readBenchOutcome(
      {
        data: JSON.stringify({
          resultData: { runData: { N: [{ data: { main: [[{ json: { ok: true } }]] } }] } },
        }),
      },
      'N',
    );
    expect(outcome).toEqual({ status: 'ok', items: [{ ok: true }] });
  });
});
