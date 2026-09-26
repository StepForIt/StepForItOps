import { describe, expect, it } from 'vitest';
import { GateVerdict } from '../src/domain/n8n/proposal-gate';
import { CheckFinding } from '../src/domain/n8n/structural-checks';
import { repairNote, repairRequest } from '../src/domain/n8n/draft-repair';

const finding = (over: Partial<CheckFinding> = {}): CheckFinding => ({
  severity: 'error',
  code: 'expression-missing-node',
  message: '"Set" référence le nœud inexistant "Webhook 2"',
  nodeName: 'Set',
  ...over,
});

const verdict = (over: Partial<GateVerdict> = {}): GateVerdict => ({
  blocked: true,
  blockedBy: 'quality',
  breaches: [],
  introduced: [],
  refusals: [],
  ...over,
});

describe('repairRequest', () => {
  it('ne demande rien quand la proposition passe', () => {
    expect(repairRequest(verdict({ blocked: false, blockedBy: undefined }))).toBeNull();
  });

  it('rend au modèle les erreurs introduites, avec leur nœud', () => {
    const request = repairRequest(verdict({ introduced: [finding()], reason: 'Modification refusée' }));
    expect(request).toContain('Webhook 2');
    expect(request).toContain('expression-missing-node');
    expect(request).toContain('Modification refusée');
  });

  it('ne réclame pas les warnings introduits : ils ne bloquent pas', () => {
    const request = repairRequest(
      verdict({ introduced: [finding({ severity: 'warning', code: 'orphan-node' })], reason: 'r' }),
    );
    expect(request).not.toContain('orphan-node');
  });

  it('dit qu’une atteinte à l’intégrité ne se contourne pas', () => {
    const request = repairRequest(
      verdict({
        blockedBy: 'integrity',
        breaches: [{ code: 'trigger-lost', message: 'Plus de déclencheur.' }],
      }),
    );
    expect(request).toContain('Plus de déclencheur.');
    expect(request).toContain('cannot be overridden');
  });

  it('demande de corriger un refus hérité dans le même brouillon', () => {
    const request = repairRequest(
      verdict({
        blockedBy: 'refusal',
        refusals: [finding({ code: 'node-unknown-collection-key', message: 'sous-clé « values »' })],
      }),
    );
    expect(request).toContain('same draft');
    expect(request).toContain('sous-clé « values »');
  });

  it('exige les opérations complètes, ou l’abandon explicite', () => {
    const request = repairRequest(verdict({ introduced: [finding()] })) ?? '';
    expect(request).toContain('COMPLETE');
    expect(request).toContain('proposal: null');
  });
});

describe('repairNote', () => {
  it('dit la correction plutôt que de la taire', () => {
    expect(repairNote('repaired', 1)).toContain('corrigée');
  });

  it('distingue l’abandon du refus persistant', () => {
    expect(repairNote('abandoned', 1)).toContain('abandonnée');
    expect(repairNote('gave-up', 2)).toContain('reste refusée');
  });
});
