import { describe, expect, it } from 'vitest';
import { MAKE_CAPABILITIES, N8N_CAPABILITIES } from '../src/ports/workflow-platform.port';
import { unavailableActions, workflowActions } from '../src/domain/workflow-actions';

describe('workflowActions', () => {
  it('n8n : tout est proposé', () => {
    const actions = workflowActions('n8n', N8N_CAPABILITIES);
    expect(Object.values(actions).every((state) => state.available)).toBe(true);
  });

  it('Make : lire, contrôler, resynchroniser et exporter le blueprint marchent', () => {
    const actions = workflowActions('make', MAKE_CAPABILITIES);
    expect(actions.sync.available).toBe(true);
    expect(actions.verify.available).toBe(true);
    expect(actions.export.available).toBe(true);
    expect(actions.naming.available).toBe(true);
    expect(actions.doc.available).toBe(true);
    expect(actions.assistant.available).toBe(true);
  });

  it("distingue ce que Make ne PERMET pas de ce qu'on n'a pas encore porté", () => {
    const actions = workflowActions('make', MAKE_CAPABILITIES);
    expect(actions.test.reason).toBe('platform');
    expect(actions.fields.reason).toBe('platform');
    expect(actions.envSwitch.reason).toBe('not-yet');
  });

  it('suit les capacités plutôt que le nom de la plateforme : un Make qui rendrait ses bundles rouvrirait le contrôle des champs', () => {
    const actions = workflowActions('make', { ...MAKE_CAPABILITIES, executionData: true, pinData: true });
    expect(actions.fields.available).toBe(true);
    expect(actions.test.available).toBe(true);
  });

  it('donne une raison lisible à chaque indisponibilité, jamais un booléen muet', () => {
    const actions = workflowActions('make', MAKE_CAPABILITIES);
    for (const { why } of unavailableActions(actions)) {
      expect(why.length).toBeGreaterThan(20);
    }
  });

  it('ne liste rien comme indisponible sur n8n', () => {
    expect(unavailableActions(workflowActions('n8n', N8N_CAPABILITIES))).toEqual([]);
  });
});
