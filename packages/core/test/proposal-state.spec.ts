import { describe, expect, it } from 'vitest';
import { proposalState, summarizeProposalStates } from '../src/domain/proposal-state';

describe('proposalState', () => {
  it('une décision humaine prime sur tout', () => {
    expect(proposalState({ status: 'applied', baseHash: 'a' }, 'b')).toBe('applied');
    expect(proposalState({ status: 'discarded', baseHash: 'a' }, 'b')).toBe('discarded');
  });

  it('en attente sur le workflow d’origine : à revoir', () => {
    expect(proposalState({ status: 'pending', baseHash: 'a' }, 'a')).toBe('pending');
  });

  it('en attente alors que le workflow a bougé : obsolète', () => {
    expect(proposalState({ status: 'pending', baseHash: 'a' }, 'b')).toBe('stale');
  });
});

describe('summarizeProposalStates', () => {
  it('rien à dire sur une conversation sans proposition', () => {
    expect(summarizeProposalStates([])).toBeNull();
  });

  it('ce qui reste à faire prime sur ce qui est tranché', () => {
    expect(summarizeProposalStates(['applied', 'discarded', 'pending'])).toEqual({
      state: 'pending',
      count: 1,
    });
    expect(summarizeProposalStates(['applied', 'stale'])).toEqual({ state: 'stale', count: 1 });
  });

  it('compte les propositions du même état', () => {
    expect(summarizeProposalStates(['applied', 'applied', 'discarded'])).toEqual({
      state: 'applied',
      count: 2,
    });
  });
});
