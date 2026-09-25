import { describe, expect, it } from 'vitest';
import { capAiBump, suggestBumpLevel } from '../src/domain/n8n/version-bump';
import { NodeDiff, WorkflowDiff } from '../src/domain/n8n/workflow-diff';

function node(partial: Partial<NodeDiff> & Pick<NodeDiff, 'name' | 'change'>): NodeDiff {
  return {
    nodeType: 'n8n-nodes-base.set',
    fields: ['parameters'],
    lines: [],
    explanations: [],
    ...partial,
  };
}

function diff(partial: Partial<WorkflowDiff> = {}): WorkflowDiff {
  return {
    nameChange: null,
    nodes: [],
    connections: { changed: false, lines: [], explanations: [] },
    settings: { changed: false, lines: [], explanations: [] },
    counts: { added: 0, removed: 0, modified: 0, renamed: 0 },
    hasChanges: true,
    ...partial,
  };
}

describe('suggestBumpLevel', () => {
  it('calls a removed node a major', () => {
    expect(suggestBumpLevel(diff({ nodes: [node({ name: 'Notifier', change: 'removed' })] })).level).toBe(
      'major',
    );
  });

  it('calls a touched trigger a major', () => {
    const trigger = node({ name: 'Webhook', change: 'modified', nodeType: 'n8n-nodes-base.webhook' });
    expect(suggestBumpLevel(diff({ nodes: [trigger] })).level).toBe('major');
  });

  it('spares a trigger that only moved on the canvas', () => {
    const moved = node({
      name: 'Webhook',
      change: 'modified',
      nodeType: 'n8n-nodes-base.webhook',
      fields: ['position'],
    });
    expect(suggestBumpLevel(diff({ nodes: [moved] })).level).toBe('patch');
  });

  it('calls an added node a minor', () => {
    expect(suggestBumpLevel(diff({ nodes: [node({ name: 'Slack', change: 'added' })] })).level).toBe('minor');
  });

  it('calls a parameter tweak a patch', () => {
    expect(suggestBumpLevel(diff({ nodes: [node({ name: 'Set', change: 'modified' })] })).level).toBe(
      'patch',
    );
  });

  it('ignores sticky notes', () => {
    const sticky = node({ name: 'Note', change: 'added', nodeType: 'n8n-nodes-base.stickyNote' });
    expect(suggestBumpLevel(diff({ nodes: [sticky] })).level).toBe('patch');
  });

  it('says so when nothing changes at all', () => {
    expect(suggestBumpLevel(diff({ hasChanges: false })).reason).toContain('identique');
  });
});

describe('capAiBump', () => {
  it('laisse l’IA monter d’un cran au-dessus de la règle', () => {
    expect(capAiBump('patch', 'minor')).toEqual({ level: 'minor', capped: false });
    expect(capAiBump('minor', 'major')).toEqual({ level: 'major', capped: false });
  });

  it('ramène une majeure sur un simple réglage à une mineure', () => {
    expect(capAiBump('patch', 'major')).toEqual({ level: 'minor', capped: true });
  });

  it('laisse l’IA descendre sous la règle', () => {
    expect(capAiBump('major', 'patch')).toEqual({ level: 'patch', capped: false });
  });
});
