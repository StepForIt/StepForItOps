import { describe, expect, it } from 'vitest';
import { N8nWorkflow, N8nNode } from '../src/domain/n8n/workflow.types';
import {
  STICKY_DEFAULT_HEIGHT,
  STICKY_DEFAULT_WIDTH,
  buildStickyZones,
  computeZoneRect,
  isDefaultStickyContent,
  parseStickyNotes,
  rectContainsRect,
  rectsPartiallyOverlap,
} from '../src/domain/n8n/sticky-zones';

function sticky(name: string, x: number, y: number, w: number, h: number, content = ''): N8nNode {
  return {
    name,
    type: 'n8n-nodes-base.stickyNote',
    position: [x, y],
    parameters: { content, width: w, height: h },
  };
}

function node(name: string, x: number, y: number): N8nNode {
  return { name, type: 'n8n-nodes-base.set', position: [x, y] };
}

function wf(nodes: N8nNode[]): N8nWorkflow {
  return { name: 'test', nodes, connections: {} };
}

describe('parseStickyNotes', () => {
  it('applies n8n defaults and reads color', () => {
    const [parsed] = parseStickyNotes(
      wf([
        {
          name: 'Note',
          type: 'n8n-nodes-base.stickyNote',
          position: [10, 20],
          parameters: { color: 4 },
        },
      ]),
    );
    expect(parsed.rect).toEqual({
      x: 10,
      y: 20,
      width: STICKY_DEFAULT_WIDTH,
      height: STICKY_DEFAULT_HEIGHT,
    });
    expect(parsed.color).toBe(4);
    expect(parsed.content).toBe('');
  });

  it('ignores stickies without position and non-sticky nodes', () => {
    const parsed = parseStickyNotes(
      wf([{ name: 'NoPos', type: 'n8n-nodes-base.stickyNote' }, node('Set', 0, 0)]),
    );
    expect(parsed).toEqual([]);
  });
});

describe('rect helpers', () => {
  const big = { x: 0, y: 0, width: 500, height: 400 };

  it('detects full containment with epsilon tolerance', () => {
    expect(rectContainsRect(big, { x: 10, y: 10, width: 100, height: 100 })).toBe(true);
    expect(rectContainsRect(big, { x: -0.5, y: 0, width: 100, height: 100 })).toBe(true);
    expect(rectContainsRect(big, { x: 450, y: 0, width: 100, height: 100 })).toBe(false);
  });

  it('detects partial overlap but not containment, disjunction or edge grazing', () => {
    expect(rectsPartiallyOverlap(big, { x: 400, y: 300, width: 200, height: 200 })).toBe(true);
    expect(rectsPartiallyOverlap(big, { x: 10, y: 10, width: 100, height: 100 })).toBe(false);
    expect(rectsPartiallyOverlap(big, { x: 600, y: 0, width: 100, height: 100 })).toBe(false);
    // Frôlement < 10 px de profondeur : pas un chevauchement.
    expect(rectsPartiallyOverlap(big, { x: 495, y: 0, width: 100, height: 400 })).toBe(false);
  });
});

describe('isDefaultStickyContent', () => {
  it('flags empty, whitespace and n8n default content', () => {
    expect(isDefaultStickyContent('')).toBe(true);
    expect(isDefaultStickyContent('   \n ')).toBe(true);
    expect(
      isDefaultStickyContent("## I'm a note \n**Double click** to edit me. [Guide](https://docs.n8n.io)"),
    ).toBe(true);
  });

  it('accepts real content', () => {
    expect(isDefaultStickyContent('## Envoi SMS\nGère les erreurs Twilio')).toBe(false);
  });
});

describe('buildStickyZones', () => {
  const workflow = wf([
    sticky('Parent', 0, 0, 1000, 800, '## Zone SMS'),
    sticky('Child', 100, 100, 300, 300),
    sticky('Lone', 2000, 0, 300, 300, '## Ailleurs'),
    node('Inner', 150, 150),
    node('InParentOnly', 600, 400),
    node('Outside', 5000, 5000),
    { name: 'NoPosition', type: 'n8n-nodes-base.set' },
  ]);
  const zones = buildStickyZones(workflow);

  it('builds sticky hierarchy (smallest enclosing parent)', () => {
    expect(zones.parentOf.get('Child')).toBe('Parent');
    expect(zones.parentOf.get('Parent')).toBeNull();
    expect(zones.parentOf.get('Lone')).toBeNull();
    expect(zones.childrenOf.get('Parent')).toEqual(['Child']);
    expect(zones.childrenOf.get('Child')).toEqual([]);
  });

  it('assigns nodes to the smallest containing sticky', () => {
    expect(zones.nodesByZone.get('Child')).toEqual(['Inner']);
    expect(zones.nodesByZone.get('Parent')).toEqual(['InParentOnly']);
    expect(zones.nodesByZone.get('Lone')).toEqual([]);
  });

  it('reports uncovered nodes but never nodes without position', () => {
    expect(zones.uncoveredNodes).toEqual(['Outside']);
  });

  it('handles deep nesting A ⊃ B ⊃ C', () => {
    const deep = buildStickyZones(
      wf([sticky('A', 0, 0, 1000, 1000), sticky('B', 50, 50, 500, 500), sticky('C', 100, 100, 200, 200)]),
    );
    expect(deep.parentOf.get('C')).toBe('B');
    expect(deep.parentOf.get('B')).toBe('A');
    expect(deep.parentOf.get('A')).toBeNull();
  });
});

describe('computeZoneRect', () => {
  it('wraps the bounding box with node footprint and paddings', () => {
    const rect = computeZoneRect([
      [100, 200],
      [500, 400],
    ]);
    expect(rect).toEqual({ x: 40, y: 110, width: 720, height: 470 });
  });
});
