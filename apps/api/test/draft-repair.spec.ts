import { beforeEach, describe, expect, it } from 'vitest';
import { EVENTS, GateVerdict, N8nWorkflow } from '@nwm/core';
import {
  DraftRepairService,
  Draft,
  ResolvedTargets,
} from '../src/modules/workflow-chat/draft-repair.service';
import { ProposalService } from '../src/modules/workflow-chat/proposal.service';
import { EventBusService } from '../src/infra/events/event-bus.service';
import {
  OPEN_GATE,
  RecordingBus,
  ScriptedAi,
  blockedGate,
  recordingBus,
  scriptedAi,
  turn,
  workflow,
} from './helpers/fakes';

/**
 * La passe de correction du brouillon, dans le tour.
 *
 * Ce qui se joue ici n'est pas la qualité du modèle mais le CHEMIN : combien
 * d'appels IA sont consommés, ce qui est rendu quand le modèle renonce, et ce
 * qui part au module d'apprentissage. Trois issues se ressemblent beaucoup et ne
 * veulent pas dire la même chose — `gave-up` rend le brouillon refusé,
 * `abandoned` ne rend rien, `repaired` rend le corrigé — et c'est le genre de
 * distinction qu'une régression efface sans bruit.
 */

/** Un brouillon quelconque : son contenu ne compte pas, seule la porte le juge. */
function draft(summary = 'Corriger le nœud Notion'): Draft {
  return { summary, operations: [{ op: 'rename-node', node: 'A', newName: 'B' } as never], targets: [] };
}

/** Le périmètre par défaut : rien à résoudre, tout va à la racine. */
const resolveNothing = (): ResolvedTargets => ({ parts: [], rootOperations: [], rejected: [] });

/** Une pile de verdicts servis dans l'ordre, un par appel de `evaluateAll`. */
function proposalsThatVerdict(...verdicts: GateVerdict[]): { service: ProposalService; calls: number } {
  const state = { calls: 0 };
  const service = {
    async evaluateAll(): Promise<
      Array<{ workflowId: string; workflowName: string; gate: GateVerdict; candidate: N8nWorkflow }>
    > {
      const gate = verdicts[state.calls] ?? OPEN_GATE;
      state.calls += 1;
      return [{ workflowId: 'wf1', workflowName: 'Facturation', gate, candidate: workflow('Facturation') }];
    },
  } as unknown as ProposalService;
  return {
    service,
    get calls() {
      return state.calls;
    },
  };
}

function makeService(proposals: ProposalService, ai: ScriptedAi, bus: RecordingBus): DraftRepairService {
  return new DraftRepairService(proposals, ai, bus as unknown as EventBusService);
}

describe('DraftRepairService', () => {
  let bus: RecordingBus;
  beforeEach(() => {
    bus = recordingBus();
  });

  it('ne consomme aucun appel IA quand la porte laisse passer', async () => {
    const ai = scriptedAi([]);
    const service = makeService(proposalsThatVerdict(OPEN_GATE).service, ai, bus);

    const result = await service.repair({
      workflowId: 'wf1',
      draft: draft(),
      resolve: resolveNothing,
      call: {} as never,
      messages: [],
      answer: 'ok',
    });

    expect(result.outcome).toBe('clean');
    expect(result.attempts).toBe(0);
    expect(ai.calls).toHaveLength(0);
    // Rien n'a été refusé : il n'y a rien à apprendre.
    expect(bus.emitted).toHaveLength(0);
  });

  it('renvoie le refus au modèle et retient sa correction', async () => {
    const corrected = {
      summary: 'Corrigé',
      operations: [{ op: 'rename-node', node: 'A', newName: 'C' }],
      targets: [],
    };
    const ai = scriptedAi([turn('Je corrige la sous-clé.', corrected)]);
    const service = makeService(
      proposalsThatVerdict(blockedGate('sous-clé « values » non déclarée')).service,
      ai,
      bus,
    );

    const result = await service.repair({
      workflowId: 'wf1',
      draft: draft(),
      resolve: resolveNothing,
      call: {} as never,
      messages: [],
      answer: 'première réponse',
    });

    expect(result.outcome).toBe('repaired');
    expect(result.attempts).toBe(1);
    expect(result.draft?.summary).toBe('Corrigé');
    // L'explication rendue est celle du DERNIER tour : la première décrivait le
    // diff refusé, qui n'est plus celui qu'on propose.
    expect(result.reply).toBe('Je corrige la sous-clé.');
    expect(ai.calls).toHaveLength(1);
  });

  it('annonce le refus corrigé au module d’apprentissage, avec le type du nœud', async () => {
    const opened = { count: 0 };
    const proposals = {
      async evaluateAll() {
        const blocked = opened.count === 0;
        opened.count += 1;
        return [
          {
            workflowId: 'wf1',
            workflowName: 'Facturation',
            gate: blocked ? blockedGate('sous-clé « values » non déclarée', 'Notion') : OPEN_GATE,
            candidate: workflow('Facturation', [{ name: 'Notion', type: 'n8n-nodes-base.notion' } as never]),
          },
        ];
      },
    } as unknown as ProposalService;
    const ai = scriptedAi([
      turn('Corrigé.', {
        summary: 'ok',
        operations: [{ op: 'rename-node', node: 'A', newName: 'C' }],
        targets: [],
      }),
    ]);
    const service = makeService(proposals, ai, bus);

    await service.repair({
      workflowId: 'wf1',
      draft: draft(),
      resolve: resolveNothing,
      call: {} as never,
      messages: [],
      answer: 'première réponse',
    });

    expect(bus.emitted).toHaveLength(1);
    const event = bus.emitted[0];
    expect(event?.name).toBe(EVENTS.assistantDraftRepaired);
    const payload = event?.payload as { findings: Array<{ nodeType?: string; code: string }> };
    // Le TYPE est ce qui rend la leçon transposable : un nom de nœud ne vaut que
    // dans son workflow.
    expect(payload.findings[0]?.nodeType).toBe('n8n-nodes-base.notion');
    expect(payload.findings[0]?.code).toBe('node-schema-unknown-collection-key');
  });

  it('rend le brouillon refusé après deux passes, sans appeler le modèle une troisième fois', async () => {
    const ai = scriptedAi([
      turn('Tentative 1.', {
        summary: 'v2',
        operations: [{ op: 'rename-node', node: 'A', newName: 'v2' }],
        targets: [],
      }),
      turn('Tentative 2.', {
        summary: 'v3',
        operations: [{ op: 'rename-node', node: 'A', newName: 'v3' }],
        targets: [],
      }),
    ]);
    const blocked = blockedGate('toujours refusé');
    const service = makeService(proposalsThatVerdict(blocked, blocked, blocked).service, ai, bus);

    const result = await service.repair({
      workflowId: 'wf1',
      draft: draft(),
      resolve: resolveNothing,
      call: {} as never,
      messages: [],
      answer: 'première réponse',
    });

    expect(result.outcome).toBe('gave-up');
    expect(result.attempts).toBe(2);
    // Le dernier brouillon est rendu quand même : la revue dira ce qui bloque.
    expect(result.draft?.summary).toBe('v3');
    expect(ai.calls).toHaveLength(2);
    // Un refus jamais corrigé n'apprend rien : on sait qu'il était faux, pas ce
    // qu'il aurait fallu écrire.
    expect(bus.emitted).toHaveLength(0);
  });

  it('ne rend aucun brouillon quand le modèle renonce', async () => {
    const ai = scriptedAi([turn('Je ne sais pas corriger : il me manque le schéma du nœud.')]);
    const service = makeService(proposalsThatVerdict(blockedGate('refusé')).service, ai, bus);

    const result = await service.repair({
      workflowId: 'wf1',
      draft: draft(),
      resolve: resolveNothing,
      call: {} as never,
      messages: [],
      answer: 'première réponse',
    });

    expect(result.outcome).toBe('abandoned');
    expect(result.draft).toBeNull();
    // Ce qui lui manque est la seule chose utile du tour : elle doit remonter.
    expect(result.reply).toContain('il me manque');
  });

  it('distingue une enveloppe illisible d’un renoncement', async () => {
    // Une grosse modification tronquée par le budget de jetons : le modèle a
    // bien rédigé une correction, on ne sait pas la lire.
    const truncated =
      '{"reply":"Voici la correction","proposal":{"summary":"gros","operations":[{"op":"set-node-parameters"';
    const ai = scriptedAi([truncated]);
    const service = makeService(proposalsThatVerdict(blockedGate('refusé')).service, ai, bus);

    const result = await service.repair({
      workflowId: 'wf1',
      draft: draft('brouillon d’origine'),
      resolve: resolveNothing,
      call: {} as never,
      messages: [],
      answer: 'première réponse',
    });

    expect(result.outcome).toBe('gave-up');
    // Et surtout PAS null : le brouillon refusé reste lisible en revue.
    expect(result.draft?.summary).toBe('brouillon d’origine');
  });

  it('refuse une cible hors périmètre avant même d’ouvrir la porte', async () => {
    const opened = { count: 0 };
    const proposals = {
      async evaluateAll() {
        opened.count += 1;
        return [
          {
            workflowId: 'wf1',
            workflowName: 'Facturation',
            gate: OPEN_GATE,
            candidate: workflow('Facturation'),
          },
        ];
      },
    } as unknown as ProposalService;
    const ai = scriptedAi([
      turn('Je retire la cible.', {
        summary: 'ok',
        operations: [{ op: 'rename-node', node: 'A', newName: 'C' }],
        targets: [],
      }),
    ]);
    const service = makeService(proposals, ai, bus);

    const result = await service.repair({
      workflowId: 'wf1',
      draft: { ...draft(), targets: [{ workflow: 'Inconnu', operations: [] }] },
      // Le périmètre répond sur les cibles qu'on lui soumet : la correction,
      // elle, n'en vise plus aucune.
      resolve: (targets) => ({
        parts: [],
        rootOperations: [],
        rejected: targets
          .filter((target) => target.workflow === 'Inconnu')
          .map((target) => ({ workflow: target.workflow, reason: 'hors périmètre' })),
      }),
      call: {} as never,
      messages: [],
      answer: 'première réponse',
    });

    expect(result.outcome).toBe('repaired');
    // La porte n'a été ouverte qu'APRÈS la correction : appliquer des opérations
    // à un workflow qui ne sera pas écrit ne dit rien de ce qui bloque.
    expect(opened.count).toBe(1);
    // La plainte nomme la cible fautive, sinon le modèle corrige à l'aveugle.
    const complaint = ai.calls[0]?.messages.at(-1)?.content as string;
    expect(complaint).toContain('Inconnu');
    expect(complaint).toContain('hors périmètre');
  });

  it('traite des opérations inapplicables comme un refus, avec le message d’erreur', async () => {
    const attempts = { count: 0 };
    const proposals = {
      async evaluateAll() {
        attempts.count += 1;
        if (attempts.count === 1) throw new Error('nœud « A » introuvable');
        return [
          {
            workflowId: 'wf1',
            workflowName: 'Facturation',
            gate: OPEN_GATE,
            candidate: workflow('Facturation'),
          },
        ];
      },
    } as unknown as ProposalService;
    const ai = scriptedAi([
      turn('Corrigé.', {
        summary: 'ok',
        operations: [{ op: 'rename-node', node: 'A', newName: 'C' }],
        targets: [],
      }),
    ]);
    const service = makeService(proposals, ai, bus);

    const result = await service.repair({
      workflowId: 'wf1',
      draft: draft(),
      resolve: resolveNothing,
      call: {} as never,
      messages: [],
      answer: 'première réponse',
    });

    expect(result.outcome).toBe('repaired');
    expect(ai.calls[0]?.messages.at(-1)?.content).toContain('nœud « A » introuvable');
    // Une opération inapplicable n'a pas de finding : la porte n'a pas eu lieu.
    expect(bus.emitted).toHaveLength(0);
  });
});
