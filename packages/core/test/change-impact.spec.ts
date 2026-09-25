import { describe, expect, it } from 'vitest';
import { N8nNode } from '../src/domain/n8n/workflow.types';
import { describeCron, explainConnectionChanges, explainNodeChange } from '../src/domain/n8n/change-impact';

const cronNode = (expression: string): N8nNode => ({
  name: 'Schedule daily run',
  type: 'n8n-nodes-base.scheduleTrigger',
  parameters: { rule: { interval: [{ field: 'cronExpression', expression }] } },
});

describe('describeCron', () => {
  it('lit une plage de jours', () => {
    expect(describeCron('0 10 * * 1-5')).toBe('du lundi au vendredi à 10:00');
    expect(describeCron('30 8 * * *')).toBe('tous les jours à 08:30');
    expect(describeCron('0 9 * * 1,3')).toBe('le lundi et mercredi à 09:00');
  });

  it('lit un jour du mois et la forme à 6 champs', () => {
    expect(describeCron('0 6 1 * *')).toBe('le 1 de chaque mois à 06:00');
    expect(describeCron('0 0 6 * * *')).toBe('tous les jours à 06:00');
  });

  it('se tait plutôt que de lire de travers', () => {
    expect(describeCron('*/15 * * * *')).toBeNull();
    expect(describeCron('0 10 * 3 1-5')).toBeNull();
    expect(describeCron('n importe quoi')).toBeNull();
  });
});

describe('explainNodeChange', () => {
  it('raconte un changement de cron au lieu de le recopier', () => {
    const [first] = explainNodeChange(cronNode('0 10 * * 1-6'), cronNode('0 10 * * 1-5'));
    expect(first.text).toBe('Déclenchement : du lundi au samedi à 10:00 → du lundi au vendredi à 10:00');
    expect(first.path).toBe('rule.interval[0].expression');
  });

  it('garde la valeur brute quand le cron n’est pas lisible', () => {
    const [first] = explainNodeChange(cronNode('*/5 * * * *'), cronNode('*/10 * * * *'));
    expect(first.text).toContain('*/10 * * * *');
  });

  it('signale une désactivation comme un effet, pas comme un champ', () => {
    const before: N8nNode = { name: 'Send', type: 'n8n-nodes-base.gmail' };
    const explanations = explainNodeChange(before, { ...before, disabled: true });
    expect(explanations[0].level).toBe('warning');
    expect(explanations[0].text).toContain('ne s');
  });

  it('dit qu’un déplacement ne change rien', () => {
    const before: N8nNode = { name: 'Set', type: 'n8n-nodes-base.set', position: [0, 0] };
    const explanations = explainNodeChange(before, { ...before, position: [40, 0] });
    expect(explanations).toHaveLength(1);
    expect(explanations[0].text).toContain('Déplacement');
  });

  it('couvre l’ajout et la suppression', () => {
    const node: N8nNode = { name: 'Set', type: 'n8n-nodes-base.set' };
    expect(explainNodeChange(undefined, node)[0].text).toContain('Nouveau nœud');
    expect(explainNodeChange(node, undefined)[0].level).toBe('warning');
  });
});

describe('explainConnectionChanges', () => {
  const link = (from: string, to: string, outputs = 1) => ({
    [from]: {
      main: Array.from({ length: outputs }, (_, index) =>
        index === outputs - 1 ? [{ node: to, type: 'main', index: 0 }] : [],
      ),
    },
  });

  it('dit qui alimente qui, et qui ne le fait plus', () => {
    const explanations = explainConnectionChanges(link('A', 'B'), link('A', 'C'));
    expect(explanations.map((e) => e.text)).toEqual([
      '« A » alimente désormais « C »',
      "« A » n'alimente plus « B »",
    ]);
  });

  it('précise la sortie quand ce n’est pas la première', () => {
    const [added] = explainConnectionChanges({}, link('Choix', 'Faux', 2));
    expect(added.text).toBe('« Choix » alimente désormais « Faux » (sortie 2)');
  });
});

describe('perte massive de paramètres', () => {
  it('annonce en orange, et en tête, un nœud dont un bloc entier a disparu', () => {
    const before = {
      name: 'Update',
      type: 'n8n-nodes-base.airtable',
      position: [0, 0] as [number, number],
      parameters: {
        columns: {
          value: { A: 1, B: 2 },
          schema: Array.from({ length: 40 }, (_, index) => ({ id: `col${index}` })),
        },
      },
    };
    const after = { ...before, parameters: { columns: { value: { A: 1 } } } };

    const [first] = explainNodeChange(before, after);
    expect(first.level).toBe('warning');
    expect(first.text).toMatch(/perd \d+ paramètres/);
  });
});
