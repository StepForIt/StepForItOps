/**
 * « Publier comme la source » : après une promotion, chaque exemplaire écrit sur la
 * cible est publié si son homologue l'est dans l'env source — et laissé en
 * brouillon sinon. Oublier de le faire à la main laissait une preprod ou une prod
 * à moitié éteinte.
 *
 * L'ordre est celui des appels, les appelés d'abord : n8n refuse de publier un
 * workflow dont un sous-workflow est en brouillon. Et la chaîne se met en PAUSE au
 * premier refus plutôt que de continuer : ses appelants seraient refusés à leur
 * tour, pour la même raison, et le message utile serait noyé dans leurs échecs.
 */

/** Un workflow de l'arbre d'appels côté source. */
export interface PublicationSourceNode {
  id: string;
  name: string;
  published: boolean;
  /** Ids n8n des sous-workflows qu'il appelle (ceux que n8n contrôle à la publication). */
  callees: string[];
}

/** La contrepartie d'un workflow source sur la cible, telle que n8n la sert. */
export interface PublicationTargetNode {
  externalId: string;
  name: string;
  published: boolean;
  archived?: boolean;
}

export type PublicationStepState =
  /** À publier. */
  | 'pending'
  /** Publié par la chaîne. */
  | 'done'
  /** Déjà publié sur la cible. */
  | 'already'
  /** En brouillon dans la source : il le reste. */
  | 'kept-draft'
  /** Rien à publier : pas de contrepartie, ou archivée. `reason` le dit. */
  | 'not-applicable'
  /** Refusé : la chaîne est en pause dessus. */
  | 'failed'
  /** Passé à la main après un refus. */
  | 'skipped';

export interface PublicationStep {
  instanceId: string;
  /** Env de la cible de cette étape (étapes de chaîne dev → preprod → prod). */
  env?: string | null;
  /** Id n8n sur la cible ; absent quand la contrepartie n'existe pas. */
  externalId?: string;
  name: string;
  sourceName: string;
  state: PublicationStepState;
  reason?: string;
}

export type PublicationRunStatus = 'running' | 'paused' | 'done' | 'abandoned';

export interface PublicationRun {
  status: PublicationRunStatus;
  steps: PublicationStep[];
}

/**
 * L'arbre d'appels à partir de `rootId`, les appelés d'abord. Un appelé partagé par
 * deux branches n'apparaît qu'une fois, un cycle ne boucle pas, un id inconnu est ignoré.
 */
export function publicationOrder(
  rootId: string,
  lookup: (id: string) => PublicationSourceNode | undefined,
): PublicationSourceNode[] {
  const order: PublicationSourceNode[] = [];
  const seen = new Set<string>();
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = lookup(id);
    if (!node) return;
    node.callees.forEach(visit);
    order.push(node);
  };
  visit(rootId);
  return order;
}

/** Les étapes d'UNE cible, dans l'ordre des appels. */
export function planPublicationSteps(
  order: PublicationSourceNode[],
  targetOf: (sourceId: string) => PublicationTargetNode | undefined,
  leg: { instanceId: string; env?: string | null },
): PublicationStep[] {
  return order.map((source) => {
    const target = targetOf(source.id);
    const base = { instanceId: leg.instanceId, env: leg.env ?? null, sourceName: source.name };
    if (!target) {
      return {
        ...base,
        name: source.name,
        state: 'not-applicable' as const,
        reason: 'aucune contrepartie sur la cible',
      };
    }
    const step = { ...base, externalId: target.externalId, name: target.name };
    if (!source.published) return { ...step, state: 'kept-draft' as const };
    if (target.archived) {
      return { ...step, state: 'not-applicable' as const, reason: 'archivé dans n8n' };
    }
    if (target.published) return { ...step, state: 'already' as const };
    return { ...step, state: 'pending' as const };
  });
}

export function startPublicationRun(steps: PublicationStep[]): PublicationRun {
  return settle({ status: 'running', steps });
}

/** L'étape à jouer, ou -1 quand la chaîne n'a plus rien à faire (ou est arrêtée). */
export function nextPublicationStep(run: PublicationRun): number {
  if (run.status !== 'running') return -1;
  return run.steps.findIndex((step) => step.state === 'pending');
}

export function recordPublished(run: PublicationRun, index: number, already = false): PublicationRun {
  return settle(withStep(run, index, { state: already ? 'already' : 'done', reason: undefined }));
}

/** Refus de n8n (ou verrou) : la chaîne s'arrête sur cette étape. */
export function recordPublishFailure(run: PublicationRun, index: number, reason: string): PublicationRun {
  return { ...withStep(run, index, { state: 'failed', reason }), status: 'paused' };
}

/** Rejoue l'étape refusée. */
export function resumePublicationRun(run: PublicationRun): PublicationRun {
  if (run.status !== 'paused') return run;
  return settle({
    status: 'running',
    steps: run.steps.map((step) => (step.state === 'failed' ? { ...step, state: 'pending' } : step)),
  });
}

/** Passe l'étape refusée et continue avec la suite. */
export function skipPublicationStep(run: PublicationRun): PublicationRun {
  if (run.status !== 'paused') return run;
  return settle({
    status: 'running',
    steps: run.steps.map((step) => (step.state === 'failed' ? { ...step, state: 'skipped' } : step)),
  });
}

export function abandonPublicationRun(run: PublicationRun): PublicationRun {
  if (run.status === 'done') return run;
  return { ...run, status: 'abandoned' };
}

function withStep(run: PublicationRun, index: number, patch: Partial<PublicationStep>): PublicationRun {
  return { ...run, steps: run.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)) };
}

function settle(run: PublicationRun): PublicationRun {
  if (run.status !== 'running') return run;
  return run.steps.some((step) => step.state === 'pending') ? run : { ...run, status: 'done' };
}
