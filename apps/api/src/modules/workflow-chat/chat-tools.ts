import {
  AiTool,
  CheckFinding,
  CredentialChoice,
  ExampleResult,
  NodeExample,
  N8nWorkflow,
  NodeProperty,
  ScopeMember,
  WorkflowEditOperation,
  WorkflowSkeleton,
  applyEditOperations,
  checkWorkflowIntegrity,
  diffWorkflows,
  findScopeMember,
  introducedFindings,
  runWorkflowChecks,
  writeRefusingFindings,
} from '@nwm/core';
import { buildChatContext } from './workflow-context.builder';
import { SharedChatToolContext, buildSharedChatTools } from './chat-shared-tools';

/**
 * Ce que l'assistant peut aller chercher lui-même pendant sa réflexion.
 *
 * Sans ces outils il répondait en un coup, sur le contexte qu'on avait bien
 * voulu lui donner : les paramètres des gros nœuds sont élagués, et rien ne lui
 * permettait de relire sa propre modification avant de la proposer. D'où des
 * valeurs inventées et des propositions qui cassaient le workflow sans que
 * personne — modèle compris — ne le sache avant la revue du diff.
 */

/** Findings d'un workflow, rendus au modèle sous une forme courte et stable. */
function renderFindings(findings: CheckFinding[]): string {
  if (findings.length === 0) return 'aucun';
  return findings
    .map(
      (finding) =>
        `- [${finding.severity}] ${finding.code}${finding.nodeName ? ` (${finding.nodeName})` : ''} : ${finding.message}`,
    )
    .join('\n');
}

/**
 * Brouillon passé à `check_workflow`, retenu pour le cas où le tour n'aboutit
 * pas à une proposition. Le modèle sérialise ses opérations DEUX fois — une
 * fois pour l'outil, une fois dans sa réponse — et c'est la seconde qui manque :
 * réponse en prose, ou enveloppe JSON tronquée par la taille du brouillon. Le
 * diff était alors perdu alors qu'on le tenait déjà, et le message invitait à
 * « valider le diff » qui ne s'affichait nulle part.
 */
export interface CheckedDraft {
  /**
   * Le workflow visé : celui de la conversation, ou un sous-workflow du
   * périmètre. Sans lui, un brouillon repêché serait appliqué à la racine —
   * c'est-à-dire au mauvais workflow, le seul dégât que ce champ puisse causer.
   */
  workflowId: string;
  operations: WorkflowEditOperation[];
  /**
   * Le brouillon ne casse rien, n'introduit pas d'erreur et n'est refusé par
   * personne. Seul un brouillon propre est repris d'office : celui que le
   * contrôle a recalé, le modèle avait de bonnes raisons de l'abandonner.
   */
  clean: boolean;
}

/** Un workflow du périmètre, du point de vue des outils. */
export interface ChatScopeEntry extends ScopeMember {
  /** n8n refuserait d'y écrire (archivé, ou disparu de chez lui). */
  readOnly: boolean;
  readOnlyReason?: string;
}

/** Ce que l'assistant peut demander à la plateforme au sujet de l'instance. */
export interface ChatToolContext extends SharedChatToolContext {
  /** Le workflow de la conversation : celui que vise un outil sans `workflow`. */
  rootWorkflowId: string;
  /**
   * Les workflows que l'assistant a le droit de lire ET de modifier ce tour-ci :
   * celui de la conversation et les sous-workflows qu'il appelle. Relu à chaque
   * appel plutôt que figé : une création en cours de tour l'agrandit.
   */
  scope(): ChatScopeEntry[];
  /**
   * Relit un workflow du périmètre depuis n8n. C'est la seule façon pour
   * l'assistant de repartir de l'état réel sans attendre le tour suivant : quand
   * une proposition vient d'être appliquée, ou qu'on lui dit avoir édité le
   * workflow à la main, tout ce qu'il a en tête date d'avant.
   */
  loadWorkflow(workflowId: string): Promise<N8nWorkflow>;
  /**
   * Crée un sous-workflow VIDE dans n8n et l'ajoute au périmètre.
   *
   * C'est la seule écriture que l'assistant déclenche sans passer par la revue
   * du diff, et elle est volontairement inerte : un workflow inactif qui ne
   * porte qu'un déclencheur manuel, exactement ce que produit le bouton
   * « Nouveau workflow » de la liste. Ce qui compte — le CONTENU du
   * sous-workflow et l'appel qu'on lui pose depuis l'appelant — reste une
   * proposition relue en diff. Sans ce geste, l'id n8n du nouveau workflow
   * n'existerait pas encore au moment d'écrire le nœud qui l'appelle, et la
   * découpe en sous-workflow — la pratique de la maison — restait un conseil
   * que l'assistant ne savait pas exécuter.
   */
  createSubWorkflow(name: string): Promise<ChatScopeEntry>;
  /**
   * Credentials employées sur l'instance pour un type de nœud donné, et laquelle
   * serait posée d'office. L'API publique n8n ne les listant pas, elles sont
   * relevées dans les nœuds des workflows du miroir.
   */
  credentialsFor(nodeType: string): Promise<CredentialChoice[]>;
  /**
   * Enregistre la réponse de l'humain à la question posée sur une correction
   * faite à la main. `null` quand rien n'est en attente — l'outil doit alors le
   * dire au modèle plutôt que d'inventer une correction à expliquer.
   */
  answerCorrection(answer: string): Promise<{ recorded: boolean; reason?: string }>;
  /**
   * Paramètres dont la forme s'écarte de celle qu'emploient les autres nœuds du
   * même type sur l'instance. Le contrôle du graphe ne voit pas le contenu des
   * paramètres, et c'est là qu'un workflow s'est cassé.
   */
  paramShapes(workflow: N8nWorkflow): Promise<CheckFinding[]>;
  /**
   * Ce que n8n dit d'un type de nœud : ses paramètres, leurs types, les valeurs
   * admises. Sans ça, un `add-node` d'un type que l'instance n'emploie pas
   * encore ne se compare à RIEN — ni au corpus, ni au graphe — et le modèle
   * écrit de mémoire un nœud que n8n n'ouvrira pas.
   */
  describeNodeType(nodeType: string): Promise<NodeTypeDescription | null>;
  /** Types de nœuds dont le nom ou la description correspond à une recherche. */
  searchNodeTypes(
    query: string,
  ): Promise<Array<{ nodeType: string; displayName: string; description?: string }>>;
  /**
   * Non-conformités au schéma introduites par un brouillon. Complète le contrôle
   * du graphe (qui ne voit pas les paramètres) et le corpus (muet sur un type
   * absent de l'instance).
   */
  schemaCheck(workflow: N8nWorkflow): Promise<CheckFinding[]>;
  /**
   * Nœuds comparables ailleurs dans le parc, TOUTES instances confondues.
   * Le corpus de l'instance ne servait que de statistique de forme : il ne
   * montrait aucun montage. Or la façon de brancher un provider est écrite
   * dans les workflows voisins, pas dans le catalogue n8n.
   */
  findExamples(search: { nodeType?: string; query?: string; limit?: number }): Promise<ExampleResult>;
  /** Le squelette d'un workflow du parc, désigné par son nom. */
  readExample(workflowName: string): Promise<WorkflowSkeleton | null>;
  /** Appelé à chaque `check_workflow` : le brouillon vérifié, son workflow et son verdict. */
  draftChecked?(draft: CheckedDraft): void;
}

/**
 * Une propriété rendue au modèle. On garde ce qui ENGAGE — nom, type, valeurs
 * admises, condition d'apparition — et on coupe la prose : servir les
 * descriptions longues des 200 propriétés d'un nœud Notion remplirait le
 * contexte pour un contenu que le modèle connaît déjà.
 */
function renderProperty(property: NodeProperty, depth = 0): string {
  const pad = '  '.repeat(depth);
  const parts = [`${pad}- ${property.name} (${property.type ?? 'string'})`];
  if (property.required) parts.push('REQUIS');
  if (property.default !== undefined && property.default !== '') {
    parts.push(`défaut ${JSON.stringify(property.default)}`);
  }
  const values = (property.options ?? [])
    .map((option) => (option && typeof option === 'object' && 'value' in option ? option.value : undefined))
    .filter((value) => value !== undefined);
  if (property.type === 'options' && values.length > 0) {
    parts.push(`valeurs : ${values.map((value) => JSON.stringify(value)).join(', ')}`);
  }
  const show = property.displayOptions?.show;
  if (show) {
    const conditions = Object.entries(show)
      .map(([key, allowed]) => `${key}=${(allowed ?? []).map((v) => JSON.stringify(v)).join('|')}`)
      .join(', ');
    if (conditions) parts.push(`si ${conditions}`);
  }
  const lines = [parts.join(' — ')];
  // Un niveau de descente suffit : les sous-champs d'une collection sont ce
  // qu'on écrit le plus souvent de travers, plus bas c'est du détail.
  const children = (property.options ?? []).filter((option): option is NodeProperty =>
    Boolean(option && typeof option === 'object' && 'name' in option && 'type' in option),
  );
  if (depth === 0) {
    for (const child of [...children, ...(property.values ?? [])]) {
      lines.push(renderProperty(child, depth + 1));
    }
  }
  return lines.join('\n');
}

/** Un type de nœud, tel que le catalogue le décrit. */
export interface NodeTypeDescription {
  nodeType: string;
  displayName: string;
  description?: string;
  version?: number;
  versions?: number[];
  source: 'instance' | 'catalog';
  properties: NodeProperty[];
  documentation?: string;
}

/** Rendu d'un arbitrage de credential, du point de vue du modèle. */
function renderChoice(choice: CredentialChoice): string {
  if (!choice.chosen) return `- ${choice.type} : aucune connue sur l'instance`;
  const autres = choice.alternatives.map((alt) => `« ${alt.name} » (${alt.id})`).join(', ');
  return (
    `- ${choice.type} : « ${choice.chosen.name} » (id ${choice.chosen.id}, ${choice.chosen.uses} usage(s))` +
    (autres ? ` — POSÉE PAR DÉFAUT, autres candidates : ${autres}` : ' — seule de son type')
  );
}

/**
 * Un exemple du parc, rendu au modèle. Le voisinage (amont/aval) est là exprès :
 * un nœud servi seul se recopie sans son montage, et c'est le montage qu'on
 * était venu chercher.
 */
function renderExample(example: NodeExample): string {
  const lines = [
    `### ${example.nodeName} — ${example.nodeType}` +
      (example.typeVersion !== undefined ? ` v${example.typeVersion}` : ''),
    `workflow « ${example.workflow} » (instance ${example.instance})` +
      (example.duplicates > 0 ? ` — ${example.duplicates} autre(s) nœud(s) identique(s) dans le parc` : ''),
  ];
  if (example.upstream.length || example.downstream.length) {
    lines.push(
      `flux : ${example.upstream.join(', ') || '(rien en amont)'} → ${example.nodeName} → ` +
        `${example.downstream.join(', ') || '(rien en aval)'}`,
    );
  }
  if (example.credentials.length) lines.push(`credentials : ${example.credentials.join(', ')}`);
  if (example.notes) lines.push(`note : ${example.notes}`);
  lines.push(`parameters : ${JSON.stringify(example.parameters)}`);
  if (example.parametersOmitted?.length) {
    lines.push(`(clés retirées faute de place : ${example.parametersOmitted.join(', ')})`);
  }
  return lines.join('\n');
}

/**
 * Les outils sont créés par tour de conversation : ils se ferment sur l'état du
 * workflow qu'on vient de lire, pas sur un identifiant à relire à chaque appel.
 */
export function buildChatTools(raw: N8nWorkflow, context: ChatToolContext): AiTool[] {
  // État courant du tour, PAR workflow du périmètre, et non constante :
  // `sync_workflow` le remplace, et tous les autres outils doivent alors
  // travailler sur le nouveau. Le `baseline` suit, sinon `check_workflow`
  // compare un brouillon frais à un avant périmé et attribue à la modification
  // des problèmes qui étaient déjà là.
  //
  // Les sous-workflows n'y sont PAS chargés d'avance : un périmètre de six
  // membres coûterait six lectures n8n à chaque tour, pour des workflows dont la
  // plupart des demandes ne parlent jamais. Ils arrivent au premier outil qui les
  // vise, et sont alors relus dans n8n comme la racine.
  const loaded = new Map<string, N8nWorkflow>([[context.rootWorkflowId, raw]]);
  const baselines = new Map<string, CheckFinding[]>([[context.rootWorkflowId, runWorkflowChecks(raw)]]);

  /** Le workflow visé par un outil : celui qu'on nomme, ou celui de la conversation. */
  function target(key: unknown): ChatScopeEntry {
    const members = context.scope();
    const wanted = key === undefined || key === null ? '' : String(key).trim();
    if (!wanted) {
      const root = members.find((member) => member.workflowId === context.rootWorkflowId);
      if (!root) throw new Error('Périmètre indisponible pour ce tour.');
      return root;
    }
    const found = findScopeMember(members, wanted);
    if (found) return found;
    // Hors périmètre n'est pas « inexistant » : c'est le point où l'assistant
    // doit renoncer plutôt que d'écrire ailleurs. On lui rend la liste, faute de
    // quoi il retente le même nom sous une autre orthographe.
    throw new Error(
      `Workflow « ${wanted} » hors du périmètre de cette conversation. Périmètre : ` +
        members.map((member) => `« ${member.name} »`).join(', ') +
        `. Le périmètre suit les sous-workflows APPELÉS par celui de la conversation ; ` +
        `pour en toucher un autre, ouvre une conversation dessus.`,
    );
  }

  /** État courant d'un membre du périmètre, relu dans n8n au premier accès. */
  async function stateOf(member: ChatScopeEntry): Promise<N8nWorkflow> {
    const known = loaded.get(member.workflowId);
    if (known) return known;
    const fresh = await context.loadWorkflow(member.workflowId);
    loaded.set(member.workflowId, fresh);
    baselines.set(member.workflowId, runWorkflowChecks(fresh));
    return fresh;
  }

  const readNode: AiTool = {
    name: 'read_node',
    description:
      "Renvoie la configuration complète d'un nœud (type, paramètres, credentials, " +
      'réglages). À utiliser avant toute modification d’un nœud dont les paramètres sont marqués ' +
      '"parametersOmitted", et chaque fois qu’un paramètre exact est nécessaire. ' +
      '`workflow` vise un sous-workflow du périmètre ; omis, c’est celui de la conversation.',
    input: {
      type: 'object',
      properties: {
        node: { type: 'string', description: 'Nom exact du nœud' },
        workflow: {
          type: 'string',
          description: 'Nom du workflow du périmètre (défaut : celui de la conversation)',
        },
      },
      required: ['node'],
    },
    async run(input) {
      const member = target(input.workflow);
      const state = await stateOf(member);
      const name = String(input.node ?? '');
      const node = (state.nodes ?? []).find((candidate) => candidate.name === name);
      if (!node) {
        const known = (state.nodes ?? []).map((candidate) => candidate.name).join(', ');
        throw new Error(`Nœud "${name}" introuvable dans « ${member.name} ». Nœuds : ${known}`);
      }
      return JSON.stringify(node);
    },
  };

  const readWorkflow: AiTool = {
    name: 'read_workflow',
    description:
      'Renvoie le contenu complet d’un SOUS-WORKFLOW du périmètre : ses nœuds, leurs paramètres ' +
      'et son câblage. À appeler dès que la demande touche ce que fait un workflow appelé — le ' +
      'contexte du tour ne donne que le workflow de la conversation, et le nœud « Execute ' +
      'Workflow » ne dit rien de ce qu’il déclenche. read_example_workflow lit n’importe quel ' +
      'workflow du parc mais sans les paramètres, et rien de ce qu’il rend n’est modifiable.',
    input: {
      type: 'object',
      properties: {
        workflow: { type: 'string', description: 'Nom du sous-workflow, tel que le périmètre le nomme' },
      },
      required: ['workflow'],
    },
    async run(input) {
      const member = target(input.workflow);
      const state = await stateOf(member);
      const content = buildChatContext(
        state,
        { name: member.name, active: state.active === true, tags: [] },
        [],
        // Un membre du périmètre partage le budget du tour avec le workflow de la
        // conversation : servi entier, un gros sous-workflow chasserait du contexte
        // celui sur lequel on travaille.
        { budget: 40_000 },
      );
      return [
        `« ${member.name} » (id n8n ${member.externalId})` +
          (member.calledBy.length ? ` — appelé par ${member.calledBy.join(', ')}` : ''),
        member.readOnly ? `LECTURE SEULE — ${member.readOnlyReason}` : '',
        JSON.stringify(content),
        member.readOnly
          ? ''
          : `Pour le modifier, mets ses opérations dans \`proposal.targets\` avec ` +
            `\`"workflow": "${member.name}"\` — et vérifie-les d’abord par ` +
            `\`check_workflow(operations, workflow: "${member.name}")\`.`,
      ]
        .filter(Boolean)
        .join('\n\n');
    },
  };

  const createSubWorkflow: AiTool = {
    name: 'create_sub_workflow',
    description:
      'Crée un workflow VIDE dans n8n (inactif, un seul déclencheur manuel) et l’ajoute au ' +
      'périmètre, pour en faire un sous-workflow appelé depuis celui de la conversation. ' +
      'À appeler quand la découpe est décidée, AVANT de proposer quoi que ce soit : l’id n8n ' +
      'n’existe pas avant la création, et sans lui le nœud « Execute Workflow » que tu poses ' +
      'ne pointerait sur rien. Le contenu du sous-workflow et l’appel qui le déclenche restent ' +
      'des opérations à proposer, revues en diff comme le reste.',
    input: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nom du sous-workflow, explicite sur ce qu’il fait' },
      },
      required: ['name'],
    },
    async run(input) {
      const name = String(input.name ?? '').trim();
      if (!name) throw new Error('Nom du sous-workflow manquant');
      const created = await context.createSubWorkflow(name);
      return [
        `Workflow « ${created.name} » créé et vide (id n8n ${created.externalId}), inactif.`,
        `Il ne porte qu’un déclencheur manuel : remplace-le par un « Execute Workflow Trigger » ` +
          `(\`n8n-nodes-base.executeWorkflowTrigger\`) si c’est le workflow de la conversation qui doit l’appeler.`,
        `Son contenu se propose dans \`proposal.targets\` avec \`"workflow": "${created.name}"\`, ` +
          `et le nœud qui l’appelle dans \`proposal.operations\` avec ` +
          `\`"workflowId": {"__rl": true, "value": "${created.externalId}", "mode": "list", "cachedResultName": "${created.name}"}\`.`,
        `Vérifie les deux côtés avec \`check_workflow\` avant de répondre.`,
      ].join('\n\n');
    },
  };

  const checkWorkflow: AiTool = {
    name: 'check_workflow',
    description:
      'Applique un brouillon d’opérations d’édition à une COPIE du workflow (rien n’est écrit dans ' +
      'n8n) et renvoie les problèmes que ce brouillon introduit. À appeler avant de proposer une ' +
      'modification, et à nouveau après l’avoir corrigée. Vérifier n’est pas proposer : les ' +
      'opérations validées ici doivent être reprises dans la proposition finale.',
    input: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          description: 'Les opérations d’édition du brouillon, au même format que la proposition finale.',
          items: { type: 'object' },
        },
        workflow: {
          type: 'string',
          description:
            'Workflow du périmètre auquel appliquer ce brouillon (défaut : celui de la conversation). ' +
            'Un brouillon qui touche deux workflows se vérifie en DEUX appels, un par workflow.',
        },
      },
      required: ['operations'],
    },
    async run(input) {
      const member = target(input.workflow);
      const current = await stateOf(member);
      const baseline = baselines.get(member.workflowId) ?? runWorkflowChecks(current);
      const operations = (input.operations ?? []) as WorkflowEditOperation[];
      if (!Array.isArray(operations) || operations.length === 0) {
        throw new Error('Aucune opération à vérifier');
      }
      // Une opération invalide est un résultat d'outil, pas une panne : le
      // modèle corrige au tour suivant.
      const { workflow: candidate, warnings } = applyEditOperations(current, operations);
      // Les écarts de forme des paramètres passent par le même tamis « introduit » :
      // le contrôle de graphe ne les voit pas, et c'est un paramètre d'une forme
      // inattendue qui a rendu un workflow inouvrable.
      // Deux filets qui ne se recouvrent pas : le SCHÉMA (ce que n8n déclare du
      // type de nœud) tranche pour de bon mais peut manquer le type ; le CORPUS
      // (ce que font les autres nœuds de l'instance) ne prouve rien mais couvre
      // ce que le catalogue ignore. On garde les deux.
      const [shapesBefore, shapesAfter, schemaBefore, schemaAfter] = await Promise.all([
        context.paramShapes(current),
        context.paramShapes(candidate),
        context.schemaCheck(current),
        context.schemaCheck(candidate),
      ]);
      const before = [...baseline, ...shapesBefore, ...schemaBefore];
      const after = [...runWorkflowChecks(candidate), ...shapesAfter, ...schemaAfter];
      const introduced = introducedFindings(before, after);
      const resolved = introducedFindings(after, before);
      // L'intégrité est annoncée à part, et comme un refus : elle ne se contourne
      // pas à l'application, autant que le modèle le sache avant de proposer.
      const breaches = checkWorkflowIntegrity(current, candidate);
      // Ce que n8n refusera d'écrire, que le brouillon en soit l'auteur ou non :
      // il rejette le workflow ENTIER, donc une faute héritée bloque aussi cette
      // modification-ci. Le tamis « introduit » la cachait, et le modèle
      // proposait une modification qui ne pouvait pas être appliquée.
      const refusals = writeRefusingFindings(after);
      // Le brouillon est retenu ici, avec son verdict : c'est la seule copie des
      // opérations qui survive à une réponse finale sans proposition.
      context.draftChecked?.({
        workflowId: member.workflowId,
        operations,
        clean:
          breaches.length === 0 &&
          refusals.length === 0 &&
          !introduced.some((finding) => finding.severity === 'error'),
      });
      return [
        `Workflow vérifié : « ${member.name} » — opérations appliquées : ${operations.length}`,
        member.readOnly ? `LECTURE SEULE — ${member.readOnlyReason} Rien ne pourra y être écrit.` : '',
        breaches.length > 0
          ? `REFUSÉ — ce brouillon casse le workflow, il ne pourra PAS être appliqué (aucun ` +
            `contournement possible) :\n${breaches.map((breach) => `- ${breach.message}`).join('\n')}`
          : '',
        warnings.length > 0 ? `Avertissements : ${warnings.join(' ; ')}` : 'Avertissements : aucun',
        refusals.length > 0
          ? `BLOQUANT — n8n refusera d'enregistrer ce workflow tant que ceci n'est pas corrigé, même ` +
            `si ce n'est pas ce brouillon qui l'a posé. Corrige-le dans le MÊME brouillon :\n` +
            `${renderFindings(refusals)}`
          : '',
        `Problèmes INTRODUITS par ce brouillon :\n${renderFindings(introduced)}`,
        resolved.length > 0 ? `Problèmes corrigés : ${renderFindings(resolved)}` : '',
        introduced.some((finding) => finding.severity === 'error')
          ? 'Au moins une erreur est introduite : corrige le brouillon et revérifie avant de proposer.'
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');
    },
  };

  const listCredentials: AiTool = {
    name: 'list_credentials',
    description:
      'Renvoie les credentials que cette instance n8n emploie pour un type de nœud donné ' +
      '(id et nom seulement — jamais les valeurs). À appeler avant d’ajouter un nœud qui a ' +
      'besoin de credentials, pour remplir `credentials` au lieu de laisser le nœud nu.',
    input: {
      type: 'object',
      properties: {
        nodeType: {
          type: 'string',
          description: 'Type n8n du nœud, par exemple "n8n-nodes-base.notion"',
        },
      },
      required: ['nodeType'],
    },
    async run(input) {
      const nodeType = String(input.nodeType ?? '');
      const choices = await context.credentialsFor(nodeType);
      if (choices.length === 0) {
        return (
          `Aucun nœud de type "${nodeType}" ne porte de credential sur cette instance. ` +
          `Soit ce type n'en demande pas, soit ce serait le premier : pose le nœud sans, ` +
          `et dis en \`notes\` quel credential rattacher dans n8n.`
        );
      }
      return [
        `Credentials employées sur l'instance pour "${nodeType}" :`,
        choices.map(renderChoice).join('\n'),
        'Recopie le bloc `credentials` retenu dans l’opération `add-node`.',
      ].join('\n\n');
    },
  };

  const describeNodeType: AiTool = {
    name: 'describe_node_type',
    description:
      'Renvoie ce que n8n dit d’un TYPE de nœud : ses paramètres, leur type, les valeurs ' +
      'admises et sous quelle condition chacun apparaît. OBLIGATOIRE avant tout `add-node`, ' +
      'et avant de poser un paramètre que le workflow ne montre nulle part ailleurs. ' +
      'read_node dit ce qu’un nœud PORTE ; celui-ci dit ce qu’un nœud PEUT porter.',
    input: {
      type: 'object',
      properties: {
        nodeType: { type: 'string', description: 'Type n8n complet, par exemple "n8n-nodes-base.slack"' },
      },
      required: ['nodeType'],
    },
    async run(input) {
      const nodeType = String(input.nodeType ?? '').trim();
      if (!nodeType) throw new Error('Type de nœud manquant');
      const description = await context.describeNodeType(nodeType);
      if (!description) {
        // Absent du catalogue n'est pas « n'existe pas » : le dire évite que le
        // modèle annonce à l'utilisateur un type inexistant sur la foi d'un trou.
        return (
          `Type « ${nodeType} » absent du catalogue. Cela ne prouve PAS qu'il n'existe pas : ` +
          `le catalogue peut ne pas le couvrir. Cherche avec search_node_types, et si tu ne ` +
          `trouves rien, dis-le au lieu d'inventer les paramètres.`
        );
      }
      const origin =
        description.source === 'instance'
          ? "servi par l'instance n8n elle-même (fait foi)"
          : 'catalogue mutualisé — décrit un n8n voisin, pas forcément celui-ci';
      return [
        `${description.displayName} (${description.nodeType})`,
        description.description ?? '',
        `Version décrite : ${description.version ?? 'inconnue'}` +
          (description.versions?.length ? ` — versions servies : ${description.versions.join(', ')}` : '') +
          ` — source : ${origin}.`,
        'Paramètres :',
        description.properties.map((property) => renderProperty(property)).join('\n'),
        description.documentation
          ? `Documentation n8n (extrait) :\n${description.documentation.slice(0, 4000)}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');
    },
  };

  const searchNodeTypes: AiTool = {
    name: 'search_node_types',
    description:
      'Cherche un type de nœud par son nom ou ce qu’il fait (« slack », « envoyer un mail », ' +
      '« postgres »). À utiliser quand tu sais quoi faire mais pas sous quel type n8n le range : ' +
      'un type inventé produit un nœud que n8n n’ouvre pas.',
    input: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Ce que le nœud doit faire, ou son nom' } },
      required: ['query'],
    },
    async run(input) {
      const query = String(input.query ?? '').trim();
      if (query.length < 2) throw new Error('Recherche trop courte');
      const results = await context.searchNodeTypes(query);
      if (results.length === 0) return `Aucun type de nœud ne correspond à « ${query} ».`;
      return results
        .map(
          (result) =>
            `- ${result.nodeType} — ${result.displayName}${result.description ? ` : ${result.description}` : ''}`,
        )
        .join('\n');
    },
  };

  const syncWorkflow: AiTool = {
    name: 'sync_workflow',
    description:
      'Relit un workflow depuis n8n et renvoie ce qui a changé depuis le début du tour. ' +
      'À appeler quand une modification vient d’être appliquée, quand l’utilisateur dit avoir ' +
      'édité le workflow dans n8n, ou avant de proposer si la conversation dure. Les autres ' +
      'outils travaillent ensuite sur cet état.',
    input: {
      type: 'object',
      properties: {
        workflow: {
          type: 'string',
          description: 'Workflow du périmètre (défaut : celui de la conversation)',
        },
      },
    },
    async run(input) {
      const member = target(input.workflow);
      const previous = await stateOf(member);
      const current = await context.loadWorkflow(member.workflowId);
      loaded.set(member.workflowId, current);
      baselines.set(member.workflowId, runWorkflowChecks(current));

      const diff = diffWorkflows(previous, current);
      if (!diff.hasChanges) return `« ${member.name} » n’a pas bougé depuis le début du tour.`;

      const { added, removed, modified, renamed } = diff.counts;
      const nodes = diff.nodes.map((node) => `- ${node.change} : ${node.name}`).join('\n');
      return [
        `« ${member.name} » a changé dans n8n : ${added} ajouté(s), ${modified} modifié(s), ` +
          `${renamed} renommé(s), ${removed} supprimé(s).`,
        nodes,
        diff.connections.changed ? 'Le câblage a changé.' : '',
        'Tout ce que tu proposeras repart désormais de cet état.',
      ]
        .filter(Boolean)
        .join('\n\n');
    },
  };

  const { remember, listConversations, readConversation, searchDocs, readDocs } =
    buildSharedChatTools(context);

  const findExamples: AiTool = {
    name: 'find_examples',
    description:
      'Cherche dans TOUS les workflows de la plateforme (toutes instances) comment un nœud ' +
      'est configuré ailleurs : paramètres réels (secrets masqués), credential rattachée, et ' +
      'ce qui l’entoure dans le flux. À appeler avant d’ajouter ou de reconfigurer un nœud ' +
      'd’un type déjà employé ici : `describe_node_type` dit ce que n8n PERMET, celui-ci dit ' +
      'ce que la maison FAIT. Donne nodeType (le plus sûr) ou query (« nocodb », « relance mail »).',
    input: {
      type: 'object',
      properties: {
        nodeType: { type: 'string', description: 'Type n8n exact, par exemple "n8n-nodes-base.httpRequest"' },
        query: {
          type: 'string',
          description: 'Recherche libre : type, nom de nœud, de workflow, contenu des paramètres',
        },
        limit: { type: 'number', description: 'Nombre d’exemples (défaut 5, maximum 10)' },
      },
    },
    async run(input) {
      const nodeType = input.nodeType ? String(input.nodeType).trim() : undefined;
      const query = input.query ? String(input.query).trim() : undefined;
      if (!nodeType && !query) throw new Error('Donne au moins nodeType ou query');
      const result = await context.findExamples({
        ...(nodeType ? { nodeType } : {}),
        ...(query ? { query } : {}),
        ...(input.limit ? { limit: Number(input.limit) } : {}),
      });
      if (result.examples.length === 0) {
        // Rien trouvé n'est pas rien à dire : c'est peut-être le premier nœud de
        // ce type du parc, et le modèle doit alors savoir qu'il n'a pas de modèle.
        return (
          `Aucun exemple dans le parc pour ${nodeType ? `« ${nodeType} »` : `« ${query} »`}. ` +
          `Ce serait donc une première ici : appuie-toi sur describe_node_type, et dis-le.`
        );
      }
      return [
        `${result.total} nœud(s) correspondant(s) dans ${result.workflows} workflow(s) du parc. ` +
          `Voici ${result.examples.length} exemple(s), du plus récemment modifié au plus ancien :`,
        result.examples.map(renderExample).join('\n\n'),
        'Inspire-toi du MONTAGE, jamais des valeurs : ids, urls et noms de tables appartiennent ' +
          'à leur workflow. Les credentials d’une autre instance ne valent pas ici — ' +
          'list_credentials fait foi.',
      ].join('\n\n');
    },
  };

  const readExample: AiTool = {
    name: 'read_example_workflow',
    description:
      'Renvoie le squelette d’un autre workflow du parc (ses nœuds et leur enchaînement, sans ' +
      'les paramètres), désigné par son nom — celui rendu par find_examples, ou celui que ' +
      'l’utilisateur cite. À appeler quand c’est la STRUCTURE qui se copie : découpage, ' +
      'points d’entrée, jalons, gestion d’erreur. Les paramètres d’un nœud précis se ' +
      'demandent ensuite à find_examples.',
    input: {
      type: 'object',
      properties: { workflow: { type: 'string', description: 'Nom du workflow à lire' } },
      required: ['workflow'],
    },
    async run(input) {
      const name = String(input.workflow ?? '').trim();
      if (!name) throw new Error('Nom de workflow manquant');
      const skeleton = await context.readExample(name);
      if (!skeleton) return `Aucun workflow du parc ne s’appelle « ${name} » (ni ne le contient).`;
      const nodes = skeleton.nodes
        .map(
          (node) =>
            `- ${node.name} (${node.type})` +
            (node.trigger ? ' [déclencheur]' : '') +
            (node.disabled ? ' [désactivé]' : '') +
            (node.notes ? `\n  note : ${node.notes}` : ''),
        )
        .join('\n');
      return [
        `« ${skeleton.name} » — instance ${skeleton.instance}, ${skeleton.active ? 'actif' : 'inactif'}.`,
        `Nœuds :\n${nodes}`,
        skeleton.edges.length
          ? `Câblage :\n${skeleton.edges.map((edge) => `- ${edge}`).join('\n')}`
          : 'Aucune connexion.',
        skeleton.orphans.length ? `Nœuds détachés : ${skeleton.orphans.join(', ')}` : '',
        'Paramètres non fournis : demande find_examples pour le nœud qui t’intéresse.',
      ]
        .filter(Boolean)
        .join('\n\n');
    },
  };

  const answerCorrection: AiTool = {
    name: 'answer_correction',
    description:
      "Enregistre l'explication que l'humain vient de donner sur une correction qu'il avait " +
      'faite à la main. À appeler UNIQUEMENT quand le contexte du tour signalait une correction ' +
      "inexpliquée ET que l'humain vient d'y répondre. Recopie son explication telle qu'il l'a " +
      "donnée, sans l'interpréter : c'est elle qui fera règle. N'invente jamais de réponse — un " +
      'silence vaut abandon, et une règle fausse se servira ensuite à tous les tours.',
    input: {
      type: 'object',
      properties: {
        answer: { type: 'string', description: "L'explication de l'humain, dans ses termes" },
      },
      required: ['answer'],
    },
    async run(input) {
      const answer = String(input.answer ?? '').trim();
      if (!answer) throw new Error('Réponse vide');
      const result = await context.answerCorrection(answer);
      return result.recorded
        ? 'Explication enregistrée : elle servira de règle pour les prochains workflows.'
        : `Non enregistrée — ${result.reason ?? 'aucune correction en attente'}`;
    },
  };

  return [
    readNode,
    readWorkflow,
    createSubWorkflow,
    describeNodeType,
    searchNodeTypes,
    checkWorkflow,
    listCredentials,
    syncWorkflow,
    remember,
    listConversations,
    readConversation,
    answerCorrection,
    findExamples,
    readExample,
    searchDocs,
    readDocs,
  ];
}
