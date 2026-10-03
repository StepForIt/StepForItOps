import { describe, expect, it } from 'vitest';
import { workflowsIdleKind } from './empty-state';

describe('workflowsIdleKind', () => {
  it('rien d’archivé : rien n’a été importé, on propose la synchro', () => {
    expect(workflowsIdleKind(0)).toBe('not-synced');
  });

  it('des archivés masqués : on propose de les afficher plutôt que de réimporter', () => {
    expect(workflowsIdleKind(3)).toBe('all-archived');
  });
});
