import { describe, expect, it } from 'vitest';
import {
  NodeProperty,
  NodeSchema,
  applicableProperties,
  isVisible,
  runNodeSchemaChecks,
  schemaKey,
} from '../src/domain/n8n/node-schema';
import { toLongNodeType, toShortNodeType } from '../src/domain/n8n/node-type-name';
import { N8nNode, N8nWorkflow } from '../src/domain/n8n/workflow.types';

const SLACK = 'n8n-nodes-base.slack';

function node(parameters: Record<string, unknown>, extra: Partial<N8nNode> = {}): N8nNode {
  return {
    id: 'n1',
    name: 'Slack',
    type: SLACK,
    typeVersion: 2,
    position: [0, 0],
    parameters,
    ...extra,
  } as N8nNode;
}

function wf(...nodes: N8nNode[]): N8nWorkflow {
  return { id: 'w', name: 'W', nodes, connections: {} } as N8nWorkflow;
}

/** Schéma minimal mais réaliste : un `resource`, une `operation` conditionnée, une collection. */
const schema = (overrides: Partial<NodeSchema> = {}): NodeSchema => ({
  nodeType: SLACK,
  displayName: 'Slack',
  version: 2,
  source: 'catalog',
  properties: [
    {
      name: 'resource',
      type: 'options',
      default: 'message',
      options: [
        { name: 'Message', value: 'message' },
        { name: 'Channel', value: 'channel' },
      ],
    },
    {
      name: 'operation',
      type: 'options',
      default: 'post',
      displayOptions: { show: { resource: ['message'] } },
      options: [
        { name: 'Post', value: 'post' },
        { name: 'Update', value: 'update' },
      ],
    },
    { name: 'channel', type: 'string', default: '', displayOptions: { show: { resource: ['message'] } } },
    { name: 'otherOptions', type: 'collection', default: {} },
    {
      name: 'select',
      type: 'string',
      default: '',
      displayOptions: { show: { '@version': [{ _cnd: { gte: 2 } }] } },
    },
  ],
  ...overrides,
});

const codes = (workflow: N8nWorkflow, s = schema()) =>
  runNodeSchemaChecks(workflow, new Map([[SLACK, s]])).map((finding) => finding.code);

describe('visibilité selon displayOptions', () => {
  it('montre une propriété dont la condition show est remplie', () => {
    const properties = schema().properties;
    const operation = properties.find((p) => p.name === 'operation')!;
    expect(isVisible(operation, { resource: 'message' }, 2, properties)).toBe(true);
    expect(isVisible(operation, { resource: 'channel' }, 2, properties)).toBe(false);
  });

  it('applique la valeur par défaut quand le paramètre est absent du JSON', () => {
    // n8n n'écrit pas ce qui n'a pas été touché : juger sur l'absence
    // masquerait `operation` alors que le nœud est bien en mode message.
    const properties = schema().properties;
    const operation = properties.find((p) => p.name === 'operation')!;
    expect(isVisible(operation, {}, 2, properties)).toBe(true);
  });

  it('évalue une condition de version (@version)', () => {
    const properties = schema().properties;
    const select = properties.find((p) => p.name === 'select')!;
    expect(isVisible(select, {}, 2, properties)).toBe(true);
    expect(isVisible(select, {}, 1, properties)).toBe(false);
  });

  it('ne tranche pas quand la condition porte sur une expression', () => {
    // Indécis, et non « masqué » : c'est ce qui évite d'accuser un paramètre
    // parfaitement légitime dont la condition se résout à l'exécution.
    const properties = schema().properties;
    const operation = properties.find((p) => p.name === 'operation')!;
    expect(isVisible(operation, { resource: '={{ $json.kind }}' }, 2, properties)).toBeUndefined();
    expect(applicableProperties(schema(), { resource: '={{ $json.kind }}' }, 2).map((p) => p.name)).toContain(
      'operation',
    );
  });

  it('ne masque sur hide que si TOUTES les clauses correspondent', () => {
    const properties = [{ name: 'x', type: 'string', displayOptions: { hide: { a: ['1'], b: ['2'] } } }];
    expect(isVisible(properties[0], { a: '1', b: '2' }, 1, properties)).toBe(false);
    expect(isVisible(properties[0], { a: '1', b: '9' }, 1, properties)).toBe(true);
  });
});

describe('contrôle des nœuds contre le schéma', () => {
  it('ne dit rien d’un nœud conforme', () => {
    expect(codes(wf(node({ resource: 'message', operation: 'post', channel: '#general' })))).toEqual([]);
  });

  it('signale un paramètre absent du schéma', () => {
    expect(codes(wf(node({ resource: 'message', chanel: '#general' })))).toContain('node-unknown-param');
  });

  it('signale une chaîne là où le schéma attend un objet', () => {
    // Le cas qui a rendu un workflow inouvrable dans n8n : une expression à la
    // racine d'une collection, que n8n n'accepte pas.
    expect(codes(wf(node({ resource: 'message', otherOptions: '={{ $json.opts }}' })))).toContain(
      'node-param-type',
    );
  });

  it('signale une valeur hors des choix proposés', () => {
    expect(codes(wf(node({ resource: 'message', operation: 'delete' })))).toContain('node-unknown-value');
  });

  it('laisse passer une expression sur un champ scalaire', () => {
    expect(codes(wf(node({ resource: 'message', channel: '={{ $json.channel }}' })))).toEqual([]);
  });

  it('ne juge pas un paramètre que la config courante masque', () => {
    // `channel` n'existe pas pour la ressource `channel` : n8n le garde dans le
    // JSON sans l'exécuter, et le contrôler reviendrait à juger du code mort.
    expect(codes(wf(node({ resource: 'channel', channel: '#general' })))).toEqual([]);
  });

  it('se tait sur un type de nœud absent du catalogue', () => {
    const workflow = wf(node({ nimporte: 'quoi' }, { type: 'n8n-nodes-base.inconnu' }));
    expect(runNodeSchemaChecks(workflow, new Map([[SLACK, schema()]]))).toEqual([]);
  });

  it('se tait dès que la version du nœud diffère de celle du catalogue', () => {
    // Mesuré sur 2 352 workflows publics : 45 % des nœuds tournent sur une
    // version ANTÉRIEURE à celle que décrit le catalogue, dont les paramètres
    // portaient d'autres noms. Juger hors de sa version produisait 2 546 faux
    // positifs sur ce seul corpus.
    expect(codes(wf(node({ resource: 'message', nouveaute: 1 }, { typeVersion: 5 })))).toEqual([]);
    expect(codes(wf(node({ resource: 'message', nouveaute: 1 }, { typeVersion: 1 })))).toEqual([]);
  });

  it('ne signale pas les paramètres injectés par le framework n8n', () => {
    // `pollTimes` (déclencheur à scrutation), `descriptionType` (variante Tool)
    // et `requestOptions` (nœud déclaratif) n'apparaissent dans le schéma
    // d'aucun nœud : n8n les greffe. Ils faisaient 779 des 892 « inconnus ».
    expect(
      codes(wf(node({ resource: 'message', pollTimes: {}, descriptionType: 'auto', requestOptions: {} }))),
    ).toEqual([]);
  });

  it('se tait hors de sa version MÊME quand le schéma vient de l’instance', () => {
    // `/types/nodes.json` sert la description COURANTE du type, pas celle qui a
    // shippé avec la typeVersion 2 : l'instance dit quelles versions elle sert,
    // jamais ce que chacune déclarait. Sur les 2 352 workflows publics, juger
    // hors de sa version fait 5 « sous-clés non déclarées » et les 5 sont
    // fausses (Switch v2 range ses règles sous `rules`, le v3 sous `values`) —
    // or c'est la seule `error` du lot, celle qui ferme la porte DEV/PROD.
    const workflow = wf(node({ resource: 'message', nouveaute: 1 }, { typeVersion: 5 }));
    expect(codes(workflow, schema({ source: 'instance' }))).toEqual([]);
  });

  it('préfère le schéma DATÉ de la version du nœud à celui du type', () => {
    // C'est ce que sert `POST /rest/node-types` : la description du nœud tel
    // qu'il est écrit. Sans elle, un nœud en typeVersion 2 face à un catalogue
    // en 3 ne se contrôle pas du tout — la moitié du parc.
    const workflow = wf(node({ resource: 'message', chanel: '#general' }, { typeVersion: 2 }));
    const schemas = new Map<string, NodeSchema>([
      [SLACK, schema({ version: 3, properties: [{ name: 'chanel', type: 'string' }] })],
      [schemaKey(SLACK, 2), schema({ version: 2, source: 'instance' })],
    ]);
    // Le schéma daté (v2) juge et signale `chanel` ; celui du type (v3) l'admet.
    expect(runNodeSchemaChecks(workflow, schemas).map((f) => f.code)).toEqual(['node-unknown-param']);
  });

  it('retombe sur le schéma du type quand la version n’est pas décrite', () => {
    const workflow = wf(node({ resource: 'message', chanel: '#general' }, { typeVersion: 2 }));
    const schemas = new Map<string, NodeSchema>([
      [SLACK, schema()],
      [schemaKey(SLACK, 9), schema({ version: 9, source: 'instance' })],
    ]);
    expect(runNodeSchemaChecks(workflow, schemas).map((f) => f.code)).toEqual(['node-unknown-param']);
  });

  it('accepte une valeur proposée par une AUTRE variante du même paramètre', () => {
    // Un nœud déclare souvent une `operation` PAR ressource. N'en retenir qu'une
    // faisait refuser `download` (Google Drive, ressource fichier) comme non
    // proposée, alors qu'une autre variante l'admet : 624 faux positifs.
    const multi = schema({
      properties: [
        ...schema().properties,
        {
          name: 'operation',
          type: 'options',
          default: 'invite',
          displayOptions: { show: { resource: ['channel'] } },
          options: [{ name: 'Invite', value: 'invite' }],
        },
      ],
    });
    expect(codes(wf(node({ resource: 'channel', operation: 'invite' })), multi)).toEqual([]);
  });

  it('accepte un tableau pour une collection à valeurs multiples', () => {
    // n8n écrit en tableau une collection répétable ; l'exiger objet accusait
    // des nœuds QuickBooks corrects.
    expect(codes(wf(node({ resource: 'message', otherOptions: [{ a: 1 }] })))).toEqual([]);
  });

  it('nomme la source dans le message', () => {
    const [finding] = runNodeSchemaChecks(
      wf(node({ resource: 'message', chanel: 'x' })),
      new Map([[SLACK, schema({ source: 'instance' })]]),
    );
    expect(finding.message).toContain("le schéma de l'instance");
  });
});

describe('sous-clés de collection (le cas qui casse un réimport)', () => {
  // Reproduit le vrai incident : un nœud Notion dont le JSON portait
  // `fileUrls: { values: [...] }` alors que le nœud déclare `fileUrl`. n8n
  // refusait d'importer le workflow entier avec « Could not find property
  // option », sans dire quel nœud — et sur les versions plus récentes, il jette
  // la valeur en silence. La clé fautive vit à TROIS niveaux de la racine.
  const NOTION = 'n8n-nodes-base.notion';

  const notion = (): NodeSchema => ({
    nodeType: NOTION,
    displayName: 'Notion',
    version: 2,
    source: 'catalog',
    properties: [
      {
        name: 'propertiesUi',
        type: 'fixedCollection',
        options: [
          {
            name: 'propertyValues',
            displayName: 'Propriété',
            values: [
              { name: 'key', type: 'string' },
              {
                name: 'fileUrls',
                type: 'fixedCollection',
                options: [
                  { name: 'fileUrl', displayName: 'File', values: [{ name: 'url', type: 'string' }] },
                ],
              },
            ],
          },
        ],
      } as NodeProperty,
    ],
  });

  const notionNode = (fileUrls: unknown): N8nWorkflow =>
    wf({
      id: 'n',
      name: 'Notion',
      type: NOTION,
      typeVersion: 2,
      position: [0, 0],
      parameters: { propertiesUi: { propertyValues: [{ key: 'Image|files', fileUrls }] } },
    } as N8nNode);

  const run = (workflow: N8nWorkflow) => runNodeSchemaChecks(workflow, new Map([[NOTION, notion()]]));

  it('signale une sous-clé non déclarée, en erreur, avec son chemin', () => {
    const [finding] = run(notionNode({ values: [{ url: 'https://x/i.png' }] }));
    expect(finding.severity).toBe('error');
    expect(finding.code).toBe('node-unknown-collection-key');
    expect(finding.data?.path).toBe('propertiesUi.propertyValues[].fileUrls');
    expect(finding.data?.expectedKeys).toEqual(['fileUrl']);
  });

  it('signale une expression posée à la place d’une collection', () => {
    // n8n ne lève rien : il saute la valeur. C'est le cas le plus traître,
    // puisque le workflow s'importe et paraît correct.
    const [finding] = run(notionNode('={{ $json.files.map(f => ({url: f.url})) }}'));
    expect(finding.code).toBe('node-expression-collection');
    expect(finding.severity).toBe('warning');
  });

  it('ne dit rien de la forme correcte', () => {
    expect(run(notionNode({ fileUrl: [{ url: '={{ $json.url }}' }] }))).toEqual([]);
  });
});

describe('formes longue et courte du type de nœud', () => {
  it('convertit dans les deux sens', () => {
    expect(toLongNodeType('nodes-base.slack')).toBe('n8n-nodes-base.slack');
    expect(toShortNodeType('n8n-nodes-base.slack')).toBe('nodes-base.slack');
    expect(toLongNodeType('nodes-langchain.agent')).toBe('@n8n/n8n-nodes-langchain.agent');
    expect(toShortNodeType('@n8n/n8n-nodes-langchain.agent')).toBe('nodes-langchain.agent');
  });

  it('laisse intact ce qu’elle ne connaît pas', () => {
    expect(toLongNodeType('n8n-nodes-maison.truc')).toBe('n8n-nodes-maison.truc');
    expect(toShortNodeType('n8n-nodes-maison.truc')).toBe('n8n-nodes-maison.truc');
  });
});
