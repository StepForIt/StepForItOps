/**
 * Ce qu'il reste à un humain avant qu'un geste d'environnement parte : rien
 * (`ready`), une ou plusieurs décisions (`decide`), ou un refus qu'aucune case ne
 * lève (`blocked`). C'est ce qui permet, sur un lot, d'appliquer d'un clic ce qui
 * est propre et de ne présenter que ce qui demande un regard.
 *
 * Lit la preview telle que le service la calcule : aucune règle de gate n'est
 * refaite ici, seulement leur lecture.
 */

export type ReadinessStatus = 'ready' | 'decide' | 'blocked';

export type ReadinessDecisionCode =
  'diff' | 'target-active' | 'force' | 'confirm-skip' | 'unmapped' | 'locked';

export interface ReadinessDecision {
  code: ReadinessDecisionCode;
  label: string;
  details?: string[];
}

export interface Readiness {
  status: ReadinessStatus;
  decisions: ReadinessDecision[];
  /** Pourquoi c'est bloqué — vide sinon. */
  reasons: string[];
}

export interface PromotionReadinessInput {
  mode: 'create' | 'update';
  targetActive?: boolean;
  /** La cible écrasée est verrouillée : seul un forçage justifié l'ouvre. */
  targetLocked?: boolean;
  diffHasChanges: boolean;
  blockers: string[];
  forceable: boolean;
  needsSkipConfirm: boolean;
  chain: { ok: boolean; mode: 'warn' | 'block'; through: boolean };
}

function settle(decisions: ReadinessDecision[], reasons: string[]): Readiness {
  if (reasons.length > 0) return { status: 'blocked', decisions: [], reasons };
  return { status: decisions.length > 0 ? 'decide' : 'ready', decisions, reasons: [] };
}

export function promotionReadiness(input: PromotionReadinessInput): Readiness {
  const reasons: string[] = [];
  if (!input.forceable) reasons.push(...input.blockers);
  // En mode `block`, un saut d'étape non traversé ne s'ouvre par aucune case.
  if (!input.chain.ok && input.chain.mode === 'block' && !input.chain.through) {
    reasons.push("la chaîne d'environnements est en mode bloquant et cette promotion saute une étape");
  }

  const decisions: ReadinessDecision[] = [];
  if (input.mode === 'update' && input.diffHasChanges) {
    decisions.push({ code: 'diff', label: 'Relire ce que la promotion change sur la cible' });
  }
  if (input.mode === 'update' && input.targetLocked) {
    decisions.push({ code: 'locked', label: 'La cible est verrouillée : forcer demande une raison' });
  }
  if (input.mode === 'update' && input.targetActive) {
    decisions.push({ code: 'target-active', label: 'La cible est ACTIVE : elle tourne en ce moment' });
  }
  if (input.blockers.length > 0) {
    decisions.push({
      code: 'force',
      label: 'Gates au rouge — forcer en connaissance de cause',
      details: input.blockers,
    });
  }
  if (input.needsSkipConfirm) {
    decisions.push({ code: 'confirm-skip', label: "Confirmer le saut d'une étape de la chaîne" });
  }
  return settle(decisions, reasons);
}

export interface DuplicationReadinessInput {
  alreadyExists: boolean;
  sameAsSource: boolean;
  unmapped: Array<{ label?: string; key?: string }>;
}

export function duplicationReadiness(input: DuplicationReadinessInput): Readiness {
  const reasons: string[] = [];
  if (input.sameAsSource) reasons.push("le workflow est déjà dans l'env cible");
  if (input.alreadyExists) reasons.push('une copie porte déjà ce nom sur l’instance');

  const decisions: ReadinessDecision[] = [];
  if (input.unmapped.length > 0) {
    decisions.push({
      code: 'unmapped',
      label: 'Ressources sans mapping : la copie restera branchée sur les données de la source',
      details: input.unmapped.map((resource) => resource.label ?? resource.key ?? '?'),
    });
  }
  return settle(decisions, reasons);
}
