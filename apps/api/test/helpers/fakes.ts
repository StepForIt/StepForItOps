import { AiAgentParams, AiAgentResult, AiPort, GateVerdict, N8nWorkflow } from '@nwm/core';

/**
 * Les doublures des collaborateurs d'un service. Elles ne miment PAS un système
 * externe : elles rendent ce que le port promet, et rien de plus. Un faux qui
 * réimplémente n8n finit par être ce qu'on teste.
 */

/** Une porte qui laisse tout passer. */
export const OPEN_GATE: GateVerdict = { blocked: false, breaches: [], introduced: [], refusals: [] };

/** Une porte qui refuse, avec de quoi rédiger la plainte envoyée au modèle. */
export function blockedGate(message: string, nodeName = 'Notion'): GateVerdict {
  return {
    blocked: true,
    blockedBy: 'quality',
    breaches: [],
    introduced: [
      {
        code: 'node-schema-unknown-collection-key',
        severity: 'error',
        message,
        nodeName,
      },
    ],
    refusals: [],
    reason: message,
  };
}

/** Un workflow minimal, pour les cas où seuls son nom et ses types comptent. */
export function workflow(name: string, nodes: N8nWorkflow['nodes'] = []): N8nWorkflow {
  return { id: name, name, nodes, connections: {} } as N8nWorkflow;
}

/**
 * Un AiPort qui sert des réponses écrites d'avance, dans l'ordre. Épuisé, il
 * échoue au lieu de se répéter : un test qui appelle le modèle une fois de trop
 * doit le dire, pas boucler sur la dernière réponse.
 */
export type ScriptedAi = AiPort & { calls: AiAgentParams[] };

export function scriptedAi(answers: string[]): ScriptedAi {
  const calls: AiAgentParams[] = [];
  let next = 0;
  const fail = (name: string) => async () => {
    throw new Error(`${name}() n'est pas attendu dans ce test`);
  };
  return {
    calls,
    async chatWithTools(params: AiAgentParams): Promise<AiAgentResult> {
      calls.push(params);
      const text = answers[next];
      next += 1;
      if (text === undefined) throw new Error(`Appel IA #${next} non prévu par le test`);
      return { text, trace: [], thinking: [] };
    },
    generate: fail('generate'),
    generateJson: fail('generateJson'),
    chat: fail('chat'),
    isConfigured: async () => true,
    testCredentials: async () => undefined,
  } as unknown as ScriptedAi;
}

/** Un bus qui retient ce qu'on lui donne, pour vérifier ce qui a été annoncé. */
export interface RecordingBus {
  emit(name: string, payload: unknown): void;
  emitted: Array<{ name: string; payload: unknown }>;
}

export function recordingBus(): RecordingBus {
  const emitted: Array<{ name: string; payload: unknown }> = [];
  return { emitted, emit: (name, payload) => void emitted.push({ name, payload }) };
}

/** L'enveloppe JSON qu'un tour d'assistant est censé rendre. */
export function turn(reply: string, proposal: unknown = null): string {
  return JSON.stringify({ reply, proposal });
}
