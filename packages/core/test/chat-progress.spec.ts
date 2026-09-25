import { describe, expect, it } from 'vitest';
import { toolProgressStep } from '../src/domain/chat-progress';

describe('toolProgressStep', () => {
  it('nomme l’outil en français et porte son sujet', () => {
    const step = toolProgressStep('read_node', { node: 'Envoi Slack' });
    expect(step).toEqual({ label: 'Relecture d’un nœud', detail: 'Envoi Slack', done: false });
  });

  it('reste lisible pour un outil sans sujet identifiable', () => {
    expect(toolProgressStep('check_workflow', { operations: [] })).toEqual({
      label: 'Vérification du brouillon',
      detail: undefined,
      done: false,
    });
  });

  it('montre le produit visé, et non la question posée, pour une recherche de doc', () => {
    // `library` passe avant `query` : les deux sont fournis, et c'est le nom du
    // service qui dit à l'écran ce que l'assistant est allé chercher.
    expect(toolProgressStep('search_docs', { library: 'Shopify', query: 'staged upload vidéo' })).toEqual({
      label: 'Recherche de la documentation du service',
      detail: 'Shopify',
      done: false,
    });
  });

  it('n’invente rien pour un outil inconnu', () => {
    expect(toolProgressStep('futur_outil', {}).label).toBe('Outil futur_outil');
  });
});
