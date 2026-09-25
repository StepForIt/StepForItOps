import { describe, expect, it } from 'vitest';
import { CheckFinding } from '../src/domain/n8n/structural-checks';
import { evaluateProposalGate, gateEnv, introducedFindings } from '../src/domain/n8n/proposal-gate';

const finding = (over: Partial<CheckFinding> = {}): CheckFinding => ({
  severity: 'error',
  code: 'expression-missing-node',
  message: 'ref cassée',
  nodeName: 'Set',
  ...over,
});

describe('introducedFindings', () => {
  it('ne retient que ce qui n’existait pas avant', () => {
    const before = [finding()];
    const after = [finding(), finding({ code: 'orphan-node', message: 'orphelin' })];
    expect(introducedFindings(before, after).map((f) => f.code)).toEqual(['orphan-node']);
  });

  it('compte les occurrences (deux avant, trois après = une nouvelle)', () => {
    const before = [finding(), finding()];
    const after = [finding(), finding(), finding()];
    expect(introducedFindings(before, after)).toHaveLength(1);
  });

  it('ne compte pas un finding disparu', () => {
    expect(introducedFindings([finding()], [])).toHaveLength(0);
  });
});

describe('gateEnv', () => {
  it.each([
    ['prod déclaré', 'prod' as const, false, 'prod'],
    ['dev déclaré, même actif', 'dev' as const, true, 'safe'],
    ['env inconnu mais actif', null, true, 'prod'],
    ['env inconnu et inactif', null, false, 'safe'],
  ])('%s', (_label, env, active, expected) => {
    expect(gateEnv(env, active)).toBe(expected);
  });
});

describe('evaluateProposalGate', () => {
  it('laisse passer une modification qui n’introduit rien', () => {
    const verdict = evaluateProposalGate([finding()], [finding()], { env: 'prod', active: true });
    expect(verdict.blocked).toBe(false);
    expect(verdict.introduced).toHaveLength(0);
  });

  it('bloque une erreur introduite en prod', () => {
    const verdict = evaluateProposalGate([], [finding()], { env: 'prod', active: true });
    expect(verdict.blocked).toBe(true);
    expect(verdict.reason).toContain('production');
  });

  it('bloque aussi en dev : le socle ne dépend pas de l’environnement', () => {
    const verdict = evaluateProposalGate([], [finding()], { env: 'dev', active: false });
    expect(verdict.blocked).toBe(true);
    expect(verdict.blockedBy).toBe('quality');
    expect(verdict.introduced).toHaveLength(1);
  });

  it('nomme la production quand c’en est une, sans en faire la raison du refus', () => {
    const dev = evaluateProposalGate([], [finding()], { env: 'dev', active: false });
    const prod = evaluateProposalGate([], [finding()], { env: 'prod', active: true });
    expect(dev.reason).not.toContain('production');
    expect(prod.reason).toContain('production');
    expect(dev.blocked).toBe(prod.blocked);
  });

  it('laisse `force` lever le refus en dev comme en prod', () => {
    const verdict = evaluateProposalGate([], [finding()], { env: 'dev', active: false, force: true });
    expect(verdict.blocked).toBe(false);
    expect(verdict.introduced).toHaveLength(1);
  });

  it('ne bloque pas sur un warning introduit, même en prod', () => {
    const verdict = evaluateProposalGate([], [finding({ severity: 'warning' })], {
      env: 'prod',
      active: true,
    });
    expect(verdict.blocked).toBe(false);
  });

  it('cède à un force explicite', () => {
    const verdict = evaluateProposalGate([], [finding()], { env: 'prod', active: true, force: true });
    expect(verdict.blocked).toBe(false);
    expect(verdict.introduced).toHaveLength(1);
  });
});

describe('porte face à une atteinte à l’intégrité', () => {
  const breach = { code: 'trigger-lost' as const, message: 'Plus de déclencheur.' };

  it('refuse même hors production', () => {
    const verdict = evaluateProposalGate([], [], { env: 'dev', active: false, breaches: [breach] });
    expect(verdict.blocked).toBe(true);
    expect(verdict.blockedBy).toBe('integrity');
  });

  it('ne se laisse pas contourner par force', () => {
    const verdict = evaluateProposalGate([], [], {
      env: 'dev',
      active: false,
      force: true,
      breaches: [breach],
    });
    expect(verdict.blocked).toBe(true);
    expect(verdict.reason).toContain('ne se contourne pas');
  });

  it('laisse `force` lever la vérification quand l’intégrité est intacte', () => {
    const verdict = evaluateProposalGate([], [finding()], { env: 'prod', active: true, force: true });
    expect(verdict.blocked).toBe(false);
  });
});

describe('refus d’écriture (n8n rejette le workflow entier)', () => {
  const badKey = finding({
    code: 'node-unknown-collection-key',
    message: 'sous-clé « values » inconnue',
    nodeName: 'Notion',
  });

  it('bloque même quand la modification n’en est PAS l’auteur', () => {
    const verdict = evaluateProposalGate([badKey], [badKey], { env: 'dev', active: false });
    expect(verdict.blocked).toBe(true);
    expect(verdict.blockedBy).toBe('refusal');
    expect(verdict.introduced).toHaveLength(0);
    expect(verdict.refusals).toHaveLength(1);
  });

  it('bloque en dev comme en prod : n8n ne fait pas la différence', () => {
    expect(evaluateProposalGate([], [badKey], { env: 'dev', active: false }).blocked).toBe(true);
  });

  it('se contourne par `force`, à la différence de l’intégrité', () => {
    const verdict = evaluateProposalGate([badKey], [badKey], { env: 'prod', active: true, force: true });
    expect(verdict.blocked).toBe(false);
    expect(verdict.refusals).toHaveLength(1);
  });

  it('ne se déclenche pas sur les autres codes', () => {
    expect(evaluateProposalGate([], [finding()], { env: 'dev', active: false }).refusals).toHaveLength(0);
  });
});
