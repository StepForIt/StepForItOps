import { describe, expect, it } from 'vitest';
import { parseAssistantTurn } from '../src/domain/n8n/assistant-turn';

describe('parseAssistantTurn', () => {
  it('lit une enveloppe complète', () => {
    const turn = parseAssistantTurn(
      JSON.stringify({
        reply: 'Voici ce que je propose.',
        proposal: { summary: 'Renommer', operations: [{ op: 'rename-node', node: 'A', newName: 'B' }] },
      }),
    );
    expect(turn.reply).toBe('Voici ce que je propose.');
    expect(turn.proposal?.operations).toHaveLength(1);
    expect(turn.malformed).toBeFalsy();
  });

  it('lit les sous-workflows visés par la même proposition', () => {
    const turn = parseAssistantTurn(
      JSON.stringify({
        reply: 'Je découpe.',
        proposal: {
          summary: 'Découpe',
          operations: [{ op: 'add-node', node: { name: 'Appeler', type: 'n8n-nodes-base.executeWorkflow' } }],
          targets: [
            { workflow: 'Envoi de la facture', operations: [{ op: 'set-workflow-name', name: 'X' }] },
          ],
        },
      }),
    );
    expect(turn.proposal?.targets).toHaveLength(1);
    expect(turn.proposal?.targets[0]?.workflow).toBe('Envoi de la facture');
  });

  // Une modification qui ne touche QUE le sous-workflow est une proposition
  // valable : la refuser faute d'opérations sur la racine ferait disparaître le
  // diff dont on a besoin.
  it('accepte une proposition qui ne vise qu’un sous-workflow', () => {
    const turn = parseAssistantTurn(
      JSON.stringify({
        reply: 'Correction côté appelé.',
        proposal: {
          summary: 'Corriger',
          operations: [],
          targets: [
            { workflow: 'Envoi', operations: [{ op: 'set-node-disabled', node: 'A', disabled: true }] },
          ],
        },
      }),
    );
    expect(turn.proposal).not.toBeNull();
    expect(turn.proposal?.operations).toHaveLength(0);
  });

  // Sans nom de workflow, on ne sait pas où appliquer : rattacher à la racine
  // écrirait dans le mauvais workflow, le seul dégât irréparable du champ.
  it('jette une cible sans nom de workflow plutôt que de la rattacher à la racine', () => {
    const turn = parseAssistantTurn(
      JSON.stringify({
        reply: 'ok',
        proposal: {
          summary: 'X',
          operations: [{ op: 'set-workflow-name', name: 'Y' }],
          targets: [{ operations: [{ op: 'remove-node', node: 'A' }] }],
        },
      }),
    );
    expect(turn.proposal?.targets).toEqual([]);
  });

  it('accepte l’enveloppe dans un bloc de code', () => {
    const turn = parseAssistantTurn('```json\n{"reply":"ok","proposal":null}\n```');
    expect(turn.reply).toBe('ok');
  });

  it('rend la prose telle quelle quand il n’y a pas d’enveloppe', () => {
    const turn = parseAssistantTurn('Le nœud « Set » écrit {{ $json.id }} dans la sortie.');
    expect(turn.reply).toContain('$json.id');
    expect(turn.malformed).toBe(false);
  });

  // Le cas le plus fréquent en vrai : l'enveloppe est ENTIÈRE, mais le modèle a
  // rédigé son explication en markdown avec de vrais retours à la ligne dans la
  // chaîne. `JSON.parse` refuse, et la proposition partait à la poubelle.
  it('lit une enveloppe dont l’explication porte de vrais retours à la ligne', () => {
    const turn = parseAssistantTurn(
      '{"reply":"Le sous-workflow attend 8 entrées.\n\n- id\n- Price_TTC","proposal":' +
        '{"summary":"Compléter les entrées","operations":[{"op":"rename-node","node":"A","newName":"B"}]}}',
    );
    expect(turn.reply).toContain('- Price_TTC');
    expect(turn.proposal?.operations).toHaveLength(1);
    expect(turn.malformed).toBeFalsy();
  });

  // Même chose côté opérations : le `jsCode` d'un nœud Code écrit en clair.
  it('lit un code posé en clair dans les paramètres', () => {
    const turn = parseAssistantTurn(
      '{"reply":"ok","proposal":{"summary":"code","operations":' +
        '[{"op":"set-node-parameters","node":"Code","parameters":{"jsCode":"const a = 1;\nreturn a;"}}]}}',
    );
    const op = turn.proposal?.operations[0] as { parameters: { jsCode: string } } | undefined;
    expect(op?.parameters.jsCode).toBe('const a = 1;\nreturn a;');
    expect(turn.malformed).toBeFalsy();
  });

  // Le cas réel : un nœud Code aux SMS français recopié avec ses `\'`, que
  // JSON n'admet pas — la proposition entière se perdait à chaque relance.
  it('lit un code recopié avec des échappements que JSON n’admet pas', () => {
    const jsCode = String.raw`const a = ['Vous n\'avez pas'];\nconst u = '\u00e9';`;
    const turn = parseAssistantTurn(
      '{"reply":"Garde ajoutée.","proposal":{"summary":"garde","operations":' +
        `[{"op":"patch-node-parameters","node":"Code","parameters":{"jsCode":"${jsCode}"}}]}}`,
    );
    const op = turn.proposal?.operations[0] as { parameters: { jsCode: string } } | undefined;
    expect(op?.parameters.jsCode).toBe("const a = ['Vous n\\'avez pas'];\nconst u = 'é';");
    expect(turn.malformed).toBeFalsy();
  });

  describe('enveloppe illisible', () => {
    // Le cas réel : une grosse modification dépasse le budget de jetons et la
    // réponse est coupée en plein milieu du tableau d'opérations.
    const tronque = '{"reply":"J\'ai retiré les nœuds LinkedIn.","proposal":{"operations":[{"op":"remove-n';

    it('n’affiche jamais le JSON brut', () => {
      expect(parseAssistantTurn(tronque).reply).not.toContain('"operations"');
    });

    it('sauve l’explication, écrite en premier donc arrivée complète', () => {
      const turn = parseAssistantTurn(tronque);
      expect(turn.reply).toBe("J'ai retiré les nœuds LinkedIn.");
      expect(turn.proposal).toBeNull();
      expect(turn.malformed).toBe(true);
    });

    it('rend les guillemets échappés sans refermer la chaîne trop tôt', () => {
      const turn = parseAssistantTurn('{"reply":"Le nœud \\"Set\\" est en cause.","proposal":{"operat');
      expect(turn.reply).toBe('Le nœud "Set" est en cause.');
    });

    it('garde ce qui a été lu quand la coupure tombe DANS l’explication', () => {
      const turn = parseAssistantTurn('{"reply":"J\'ai commencé par relire le nœud');
      expect(turn.reply).toBe("J'ai commencé par relire le nœud");
      expect(turn.malformed).toBe(true);
    });

    it('écrit un constat quand même l’explication est perdue', () => {
      const turn = parseAssistantTurn('{"proposal":{"operations":[{"op":"remove-node"');
      expect(turn.reply).toContain('pas su relire');
      expect(turn.reply).not.toContain('"op"');
      expect(turn.malformed).toBe(true);
    });
  });
});
