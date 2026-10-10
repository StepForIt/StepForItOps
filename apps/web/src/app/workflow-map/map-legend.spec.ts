import { describe, expect, it } from 'vitest';
import { legendContent } from './map-legend';
import { nodeClass } from './map-style';
import type { WorkflowMapLink, WorkflowMapNode } from './types';

const node = (over: Partial<WorkflowMapNode> = {}): WorkflowMapNode => ({
  id: 'a',
  name: 'A',
  external: false,
  active: true,
  triggers: ['schedule'],
  ...over,
});
const link = (over: Partial<WorkflowMapLink> = {}): WorkflowMapLink => ({
  id: 'l',
  origin: 'auto',
  kind: 'execute',
  fromId: 'a',
  toId: 'b',
  ...over,
});

describe('nodeClass', () => {
  it('donne à chaque workflow la couleur de ce qu’il est', () => {
    expect(nodeClass(node())).toBe('workflow');
    expect(nodeClass(node({ external: true }))).toBe('external');
    expect(nodeClass(node({ archived: true }))).toBe('archived');
    expect(nodeClass(node({ active: false }))).toBe('inactive');
    expect(nodeClass(node({ triggers: ['sub-workflow'] }))).toBe('subworkflow');
    // Le bouton de test ne fait pas un workflow autonome.
    expect(nodeClass(node({ triggers: ['sub-workflow', 'manual'] }))).toBe('subworkflow');
  });
});

describe('legendContent', () => {
  it('garde toujours le repère de base, même sur une carte presque vide', () => {
    expect(legendContent([node()], [], false)).toEqual({ boxes: ['workflow'], arrows: ['call'] });
  });

  it('n’explique que ce qui est à l’écran', () => {
    const content = legendContent(
      [node(), node({ id: 'b', archived: true })],
      [link({ kind: 'webhook' }), link({ id: 'm', origin: 'manual', kind: 'manual' })],
      false,
    );
    expect(content.boxes).toEqual(['workflow', 'archived']);
    expect(content.arrows).toEqual(['call', 'webhook', 'manual']);
  });

  it('montre le point d’entrée seulement s’il est dessiné', () => {
    const withEntry = node({ entryPoints: [{ kind: 'webhook', label: 'https://x/hook', nodeName: 'W' }] });
    expect(legendContent([withEntry], [], true).boxes).toContain('entry');
    expect(legendContent([withEntry], [], false).boxes).not.toContain('entry');
    expect(legendContent([withEntry], [], true).arrows).toContain('entry');
  });

  it('explique l’appel à soi-même et le contexte de départ', () => {
    const content = legendContent(
      [node()],
      [link({ toId: 'a', context: { kind: 'loop', nodeCount: 3 } })],
      false,
    );
    expect(content.boxes).toContain('subcall');
    expect(content.arrows).toContain('context');
  });
});
