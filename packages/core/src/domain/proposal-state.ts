/**
 * Où en est une modification proposée par l'assistant, vue de la conversation.
 *
 * Le statut en base ne dit que ce qu'un humain a décidé (`pending`, `applied`,
 * `discarded`) ; il ne dit pas qu'une proposition en attente ne s'applique plus au
 * workflow d'aujourd'hui. Une conversation de dix tours affichait donc dix fois le
 * même « modification proposée », sans distinguer celle qui est partie en
 * production de celle qu'on a refusée, ni de celle que le workflow a laissée
 * derrière lui.
 */
export type ProposalState =
  /** À revoir : rien n'a encore été décidé, et elle porte toujours sur l'état courant. */
  | 'pending'
  /** En attente, mais le workflow a bougé depuis : elle ne dit plus la vérité. */
  | 'stale'
  /** Écrite dans n8n. */
  | 'applied'
  /** Refusée par un humain. */
  | 'discarded';

/**
 * `workflowHash` est l'empreinte du workflow à laquelle on compare : celle du
 * miroir suffit pour un badge (elle ne peut que RETARDER la péremption, jamais
 * l'inventer) ; la revue, elle, repart de n8n avant d'autoriser une écriture.
 */
export function proposalState(
  proposal: { status: string; baseHash: string },
  workflowHash: string,
): ProposalState {
  if (proposal.status === 'applied') return 'applied';
  if (proposal.status === 'discarded') return 'discarded';
  return proposal.baseHash === workflowHash ? 'pending' : 'stale';
}

/** Ce qu'une conversation entière a produit, en un seul badge. */
export interface ProposalSummary {
  state: ProposalState;
  /** Propositions dans CET état — les autres restent visibles dans le fil. */
  count: number;
}

/**
 * Une conversation mélange les états : deux propositions appliquées, une refusée,
 * une qui attend encore. La liste des conversations n'a la place que d'un badge,
 * et celui qui compte est le plus ACTIONNABLE — ce qui reste à faire prime sur ce
 * qui est déjà tranché, sinon un fil laissé en plan se cache derrière son « appliquée ».
 */
const PRIORITY: ProposalState[] = ['pending', 'stale', 'applied', 'discarded'];

export function summarizeProposalStates(states: ProposalState[]): ProposalSummary | null {
  for (const state of PRIORITY) {
    const count = states.filter((candidate) => candidate === state).length;
    if (count > 0) return { state, count };
  }
  return null;
}
