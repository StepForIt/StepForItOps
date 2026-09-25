import { LlmNodeRequirement } from '../model-audit';
import { activeParameters } from './inert-params';
import { N8nNode, N8nWorkflow } from './workflow.types';

/**
 * Ce que chaque nœud modèle d'un workflow n8n demande, lu du JSON.
 *
 * Seul CE fichier est n8n-shaped : `LlmNodeRequirement` est neutre, et les
 * règles qui le consomment le sont aussi — un scénario Make pourra les
 * alimenter sans qu'aucune règle ne soit réécrite.
 *
 * Les signaux retenus sont EXPLICITES. On ne remonte pas le graphe pour deviner
 * qu'un binaire d'amont est peut-être une image : ce signal-là produit un
 * `error`, et un `error` faux est le pire des findings.
 */

const LM_PREFIX = '@n8n/n8n-nodes-langchain.lm';
const CONNECTION_MODEL = 'ai_languageModel';
const CONNECTION_TOOL = 'ai_tool';
const CONNECTION_PARSER = 'ai_outputParser';

/** Les nœuds modèle du workflow (sub-nodes LangChain), désactivés exclus. */
export function llmModelNodes(workflow: Pick<N8nWorkflow, 'nodes'>): N8nNode[] {
  return (workflow.nodes ?? []).filter(
    (node) => typeof node.type === 'string' && node.type.startsWith(LM_PREFIX) && !node.disabled,
  );
}

export function llmNodeRequirements(workflow: N8nWorkflow): LlmNodeRequirement[] {
  const nodes = new Map((workflow.nodes ?? []).map((node) => [node.name, node]));
  const connections = workflow.connections ?? {};

  // Qui alimente quoi, par type de connexion : chez n8n les sub-nodes pointent
  // VERS leur consommateur, la table se lit donc dans ce sens-là.
  const consumersOf = (source: string, type: string): string[] =>
    (connections[source]?.[type] ?? []).flat().map((link) => link.node);

  const feeders = new Map<string, Set<string>>(); // consommateur → types reçus
  for (const source of Object.keys(connections)) {
    for (const type of Object.keys(connections[source] ?? {})) {
      if (type === 'main') continue;
      for (const target of consumersOf(source, type)) {
        const set = feeders.get(target) ?? new Set<string>();
        set.add(type);
        feeders.set(target, set);
      }
    }
  }

  return llmModelNodes(workflow).map((node) => {
    const servesNode = consumersOf(node.name, CONNECTION_MODEL)[0] ?? null;
    const consumer = servesNode ? nodes.get(servesNode) : undefined;
    const received = servesNode ? (feeders.get(servesNode) ?? new Set<string>()) : new Set<string>();
    return {
      nodeName: node.name,
      model: readModel(node),
      needsVision: consumer ? consumerTakesImages(consumer) : false,
      needsTools: received.has(CONNECTION_TOOL),
      needsStructuredOutput: received.has(CONNECTION_PARSER),
      servesNode,
      promptTemplate: consumer ? readPromptTemplate(consumer) : null,
    };
  });
}

/**
 * Le modèle écrit dans le nœud. n8n l'a rangé successivement dans une chaîne,
 * puis dans un resourceLocator — et sous trois noms selon le provider. Une
 * valeur portée par une expression ressort `null` : elle n'existe qu'à
 * l'exécution, et la juger reviendrait à juger un gabarit.
 */
export function readModel(node: N8nNode): string | null {
  const parameters = activeParameters(node);
  for (const key of ['model', 'modelId', 'modelName', 'deploymentName']) {
    const value = parameters[key];
    const resolved =
      typeof value === 'string'
        ? value
        : isRecord(value) && typeof value.value === 'string'
          ? value.value
          : null;
    if (resolved && !resolved.trim().startsWith('=')) return resolved.trim();
  }
  return null;
}

/**
 * Le consommateur reçoit-il des images ? Uniquement le signal explicite : une
 * chaîne LLM dont un message porte un type image, ou l'entrée binaire déclarée.
 */
function consumerTakesImages(consumer: N8nNode): boolean {
  const parameters = activeParameters(consumer);
  const messages = isRecord(parameters.messages) ? parameters.messages : null;
  const values = messages && Array.isArray(messages.messageValues) ? messages.messageValues : [];
  if (
    values.some((value) => isRecord(value) && typeof value.type === 'string' && /image/i.test(value.type))
  ) {
    return true;
  }
  return typeof parameters.inputType === 'string' && /image|binary/i.test(parameters.inputType);
}

/**
 * Le gabarit de prompt du consommateur : la consigne système et le texte, dans
 * l'ordre où un humain les lit. Sert d'empreinte de classification — jamais de
 * verdict à lui seul, un gabarit fait d'expressions ne dit rien.
 */
export function readPromptTemplate(consumer: N8nNode): string | null {
  const parameters = activeParameters(consumer);
  const parts: string[] = [];
  const options = isRecord(parameters.options) ? parameters.options : {};
  for (const value of [options.systemMessage, parameters.systemMessage, parameters.text, parameters.prompt]) {
    if (typeof value === 'string' && value.trim()) parts.push(value.trim());
  }
  const messages = isRecord(parameters.messages) ? parameters.messages : null;
  const values = messages && Array.isArray(messages.messageValues) ? messages.messageValues : [];
  for (const value of values) {
    if (isRecord(value) && typeof value.message === 'string' && value.message.trim()) {
      parts.push(value.message.trim());
    }
  }
  const template = parts.join('\n\n').trim();
  return template.length > 0 ? template : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
