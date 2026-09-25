import { describe, expect, it } from 'vitest';
import {
  CORRECTION_WINDOW_MS,
  correctionQuestion,
  isWithinCorrectionWindow,
  readCorrection,
} from '../src/domain/n8n/correction-lesson';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';

function workflow(nodes: N8nWorkflow['nodes'], connections: N8nWorkflow['connections'] = {}): N8nWorkflow {
  return { name: 'W', nodes, connections };
}

const HTTP = 'n8n-nodes-base.httpRequest';

describe('fenêtre', () => {
  const applied = new Date('2026-09-01T10:00:00Z');

  it('accepte une correction dans les six heures', () => {
    expect(isWithinCorrectionWindow(applied, new Date('2026-09-01T15:00:00Z'))).toBe(true);
  });

  it('refuse au-delà : ce n’est plus imputable à la proposition', () => {
    expect(isWithinCorrectionWindow(applied, new Date(applied.getTime() + CORRECTION_WINDOW_MS + 1))).toBe(
      false,
    );
  });

  it('refuse un snapshot antérieur à l’écriture', () => {
    expect(isWithinCorrectionWindow(applied, new Date('2026-09-01T09:00:00Z'))).toBe(false);
  });
});

describe('discriminant 1 — le structurel seul s’apprend', () => {
  it('une sous-clé renommée est une leçon', () => {
    const reading = readCorrection({
      wrote: workflow([
        { name: 'Notion', type: 'n8n-nodes-base.notion', parameters: { propertiesUi: { values: [] } } },
      ]),
      fixed: workflow([
        {
          name: 'Notion',
          type: 'n8n-nodes-base.notion',
          parameters: { propertiesUi: { propertyValues: [] } },
        },
      ]),
      touchedNodes: ['Notion'],
    });
    expect(reading.lessons).toHaveLength(2); // clé disparue + clé apparue
    expect(reading.lessons.every((change) => change.kind === 'structural')).toBe(true);
  });

  it('une chaîne remplacée par un objet est une leçon, sans détailler l’objet', () => {
    const reading = readCorrection({
      wrote: workflow([
        { name: 'Sheets', type: 'n8n-nodes-base.googleSheets', parameters: { sheetName: 'Feuille 1' } },
      ]),
      fixed: workflow([
        {
          name: 'Sheets',
          type: 'n8n-nodes-base.googleSheets',
          parameters: { sheetName: { __rl: true, value: 'abc', mode: 'list' } },
        },
      ]),
      touchedNodes: ['Sheets'],
    });
    expect(reading.lessons).toHaveLength(1);
    expect(reading.lessons[0].path).toBe('sheetName');
  });

  it('une valeur corrigée n’apprend rien', () => {
    const reading = readCorrection({
      wrote: workflow([{ name: 'HTTP', type: HTTP, parameters: { limit: 50 } }]),
      fixed: workflow([{ name: 'HTTP', type: HTTP, parameters: { limit: 100 } }]),
      touchedNodes: ['HTTP'],
    });
    expect(reading.lessons).toHaveLength(0);
    expect(reading.questions).toHaveLength(0);
    expect(reading.empty).toBe(true);
  });

  it('un réglage de nœud corrigé à la main est une leçon', () => {
    const reading = readCorrection({
      wrote: workflow([{ name: 'HTTP', type: HTTP, parameters: {} }]),
      fixed: workflow([{ name: 'HTTP', type: HTTP, parameters: {}, retryOnFail: true }]),
      touchedNodes: ['HTTP'],
    });
    expect(reading.lessons).toHaveLength(1);
    expect(reading.lessons[0].path).toBe('retryOnFail');
  });

  it('une position déplacée n’est pas une correction', () => {
    const reading = readCorrection({
      wrote: workflow([{ name: 'HTTP', type: HTTP, parameters: {}, position: [0, 0] }]),
      fixed: workflow([{ name: 'HTTP', type: HTTP, parameters: {}, position: [500, 240] }]),
      touchedNodes: ['HTTP'],
    });
    expect(reading.changes).toHaveLength(0);
  });
});

describe('discriminant 2 — la fenêtre borne le périmètre', () => {
  it('ignore un nœud que la proposition n’a pas touché', () => {
    const reading = readCorrection({
      wrote: workflow([
        { name: 'HTTP', type: HTTP, parameters: { url: 'https://a' } },
        { name: 'Autre', type: HTTP, parameters: { url: 'https://b' } },
      ]),
      fixed: workflow([
        { name: 'HTTP', type: HTTP, parameters: { url: 'https://a' } },
        { name: 'Autre', type: HTTP, parameters: { body: {} } },
      ]),
      touchedNodes: ['HTTP'],
    });
    expect(reading.changes).toHaveLength(0);
  });

  it('ne lit un câblage refait que si la proposition y touchait', () => {
    const before = workflow([{ name: 'A', type: HTTP, parameters: {} }], {});
    const after = workflow([{ name: 'A', type: HTTP, parameters: {} }], {
      A: { main: [[{ node: 'B', type: 'main', index: 0 }]] },
    });
    expect(readCorrection({ wrote: before, fixed: after, touchedNodes: ['A'] }).changes).toHaveLength(0);
    expect(
      readCorrection({ wrote: before, fixed: after, touchedNodes: ['A'], touchedConnections: true })
        .questions,
    ).toHaveLength(1);
  });
});

describe('discriminant 3 — ce qui reste se demande', () => {
  it('un nœud ajouté à la main se demande, même hors périmètre', () => {
    const reading = readCorrection({
      wrote: workflow([{ name: 'HTTP', type: HTTP, parameters: {} }]),
      fixed: workflow([
        { name: 'HTTP', type: HTTP, parameters: {} },
        { name: 'Attendre', type: 'n8n-nodes-base.wait', parameters: {} },
      ]),
      touchedNodes: ['HTTP'],
    });
    expect(reading.questions).toHaveLength(1);
    expect(reading.questions[0].node).toBe('Attendre');
  });

  it('un nœud supprimé à la main se demande', () => {
    const reading = readCorrection({
      wrote: workflow([
        { name: 'HTTP', type: HTTP, parameters: {} },
        { name: 'De trop', type: 'n8n-nodes-base.set', parameters: {} },
      ]),
      fixed: workflow([{ name: 'HTTP', type: HTTP, parameters: {} }]),
      touchedNodes: ['HTTP'],
    });
    expect(reading.questions.map((change) => change.node)).toEqual(['De trop']);
  });

  it('un gabarit remplacé par une vraie valeur se demande, sans devenir une règle', () => {
    const reading = readCorrection({
      wrote: workflow([{ name: 'HTTP', type: HTTP, parameters: { url: 'https://example.com/v1' } }]),
      fixed: workflow([{ name: 'HTTP', type: HTTP, parameters: { url: 'https://crm.interne/v1' } }]),
      touchedNodes: ['HTTP'],
    });
    expect(reading.lessons).toHaveLength(0);
    expect(reading.questions).toHaveLength(1);
  });

  it('ne pose qu’une question et annonce ce qu’elle laisse de côté', () => {
    const reading = readCorrection({
      wrote: workflow([{ name: 'HTTP', type: HTTP, parameters: {} }]),
      fixed: workflow([
        { name: 'HTTP', type: HTTP, parameters: {} },
        { name: 'A', type: 'n8n-nodes-base.set', parameters: {} },
        { name: 'B', type: 'n8n-nodes-base.set', parameters: {} },
      ]),
      touchedNodes: ['HTTP'],
    });
    const question = correctionQuestion(reading);
    expect(question).toContain('"A"');
    expect(question).toContain('1 autre point non repris');
  });

  it('rend null quand il n’y a rien à demander', () => {
    expect(correctionQuestion({ changes: [], lessons: [], questions: [], empty: true })).toBeNull();
  });
});
