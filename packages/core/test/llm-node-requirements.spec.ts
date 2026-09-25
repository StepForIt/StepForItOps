import { describe, expect, it } from 'vitest';
import { N8nWorkflow, llmNodeRequirements, promptFingerprint, templateIsTelling } from '../src';

function workflow(overrides: Partial<N8nWorkflow> = {}): N8nWorkflow {
  return {
    name: 'Traduction',
    nodes: [
      {
        name: 'Chat Model',
        type: '@n8n/n8n-nodes-langchain.lmChatAnthropic',
        parameters: { model: { __rl: true, value: 'claude-sonnet-5', mode: 'list' } },
      },
      {
        name: 'Traduire',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        parameters: { text: 'Traduis ce texte en anglais, sans rien ajouter : {{ $json.corps }}' },
      },
    ],
    connections: {
      'Chat Model': { ai_languageModel: [[{ node: 'Traduire', type: 'ai_languageModel', index: 0 }]] },
    },
    ...overrides,
  };
}

describe('llmNodeRequirements', () => {
  it('lit le modèle dans un resourceLocator comme dans une chaîne', () => {
    const [requirement] = llmNodeRequirements(workflow());
    expect(requirement?.model).toBe('claude-sonnet-5');
    expect(requirement?.servesNode).toBe('Traduire');
  });

  it("ne juge pas un modèle porté par une expression : il n'existe qu'à l'exécution", () => {
    const wf = workflow();
    wf.nodes[0]!.parameters = { model: '={{ $json.modele }}' };
    expect(llmNodeRequirements(wf)[0]?.model).toBeNull();
  });

  it('voit les outils branchés sur le consommateur, pas sur le modèle', () => {
    const wf = workflow();
    wf.nodes.push({ name: 'Calculatrice', type: '@n8n/n8n-nodes-langchain.toolCalculator' });
    wf.connections['Calculatrice'] = { ai_tool: [[{ node: 'Traduire', type: 'ai_tool', index: 0 }]] };
    expect(llmNodeRequirements(wf)[0]?.needsTools).toBe(true);
  });

  it('voit un parser structuré', () => {
    const wf = workflow();
    wf.nodes.push({ name: 'Parser', type: '@n8n/n8n-nodes-langchain.outputParserStructured' });
    wf.connections['Parser'] = {
      ai_outputParser: [[{ node: 'Traduire', type: 'ai_outputParser', index: 0 }]],
    };
    expect(llmNodeRequirements(wf)[0]?.needsStructuredOutput).toBe(true);
  });

  it('ne DEVINE pas une image : seul le signal explicite compte', () => {
    const wf = workflow();
    wf.nodes.push({ name: 'Lire fichier', type: 'n8n-nodes-base.readBinaryFile' });
    wf.connections['Lire fichier'] = { main: [[{ node: 'Traduire', type: 'main', index: 0 }]] };
    expect(llmNodeRequirements(wf)[0]?.needsVision).toBe(false);

    wf.nodes[1]!.parameters = {
      messages: { messageValues: [{ type: 'imageUrl', imageUrls: 'https://…' }] },
    };
    expect(llmNodeRequirements(wf)[0]?.needsVision).toBe(true);
  });

  it('ignore un nœud modèle désactivé', () => {
    const wf = workflow();
    wf.nodes[0]!.disabled = true;
    expect(llmNodeRequirements(wf)).toHaveLength(0);
  });

  it('remonte le gabarit du prompt, consigne système comprise', () => {
    const wf = workflow();
    wf.nodes[1]!.parameters = { text: 'Traduis.', options: { systemMessage: 'Tu es traducteur.' } };
    expect(llmNodeRequirements(wf)[0]?.promptTemplate).toBe('Tu es traducteur.\n\nTraduis.');
  });
});

describe('templateIsTelling — le gabarit dit-il assez pour classer ?', () => {
  it('accepte une consigne écrite', () => {
    expect(templateIsTelling('Traduis ce texte en anglais sans rien ajouter ni retirer au sens.')).toBe(true);
  });

  it("refuse un gabarit qui n'est qu'une expression : le texte réel vit dans l'exécution", () => {
    expect(templateIsTelling('{{ $json.consigne }}')).toBe(false);
    expect(templateIsTelling(null)).toBe(false);
  });
});

describe('promptFingerprint', () => {
  it('ignore les espaces de bord, distingue le reste', () => {
    expect(promptFingerprint(' Traduis. ')).toBe(promptFingerprint('Traduis.'));
    expect(promptFingerprint('Traduis.')).not.toBe(promptFingerprint('Résume.'));
  });
});
