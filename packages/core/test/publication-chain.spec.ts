import { describe, expect, it } from 'vitest';
import {
  PublicationSourceNode,
  PublicationTargetNode,
  abandonPublicationRun,
  nextPublicationStep,
  planPublicationSteps,
  publicationOrder,
  recordPublishFailure,
  recordPublished,
  resumePublicationRun,
  skipPublicationStep,
  startPublicationRun,
} from '../src/domain/n8n/publication-chain';
import { isPublished } from '../src/domain/n8n/n8n-publish-model';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';

const node = (id: string, callees: string[] = [], published = true): PublicationSourceNode => ({
  id,
  name: id,
  published,
  callees,
});

const graph = (...nodes: PublicationSourceNode[]) => {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (id: string) => byId.get(id);
};

const leg = { instanceId: 'prod', env: 'prod' };

/** Contrepartie « <id> - PROD », en brouillon sauf mention. */
const targets =
  (overrides: Record<string, Partial<PublicationTargetNode> | null> = {}) =>
  (sourceId: string): PublicationTargetNode | undefined => {
    if (overrides[sourceId] === null) return undefined;
    return {
      externalId: `t-${sourceId}`,
      name: `${sourceId} - PROD`,
      published: false,
      ...overrides[sourceId],
    };
  };

describe('publicationOrder', () => {
  it('publie les appelés d’abord, sur trois niveaux', () => {
    const order = publicationOrder(
      'Create Product From Airtable',
      graph(
        node('Create Product From Airtable', ['SubWorkflow create product and collection']),
        node('SubWorkflow create product and collection', ['Création de collection']),
        node('Création de collection'),
      ),
    );
    expect(order.map((n) => n.id)).toEqual([
      'Création de collection',
      'SubWorkflow create product and collection',
      'Create Product From Airtable',
    ]);
  });

  it('ne compte qu’une fois un appelé partagé par deux branches', () => {
    const order = publicationOrder(
      'root',
      graph(node('root', ['a', 'b']), node('a', ['c']), node('b', ['c']), node('c')),
    );
    expect(order.map((n) => n.id)).toEqual(['c', 'a', 'b', 'root']);
  });

  it('ne boucle pas sur un cycle d’appels', () => {
    const order = publicationOrder('a', graph(node('a', ['b']), node('b', ['a'])));
    expect(order.map((n) => n.id)).toEqual(['b', 'a']);
  });

  it('ignore un appelé inconnu', () => {
    expect(publicationOrder('a', graph(node('a', ['ghost']))).map((n) => n.id)).toEqual(['a']);
  });
});

describe('planPublicationSteps', () => {
  it('publie ce qui l’est en source, laisse en brouillon ce qui ne l’est pas', () => {
    const order = [node('draft', [], false), node('live'), node('root', ['draft', 'live'])];
    const steps = planPublicationSteps(order, targets(), leg);
    expect(steps.map((s) => [s.name, s.state])).toEqual([
      ['draft - PROD', 'kept-draft'],
      ['live - PROD', 'pending'],
      ['root - PROD', 'pending'],
    ]);
  });

  it('ne republie pas une cible déjà publiée', () => {
    const steps = planPublicationSteps([node('a')], targets({ a: { published: true } }), leg);
    expect(steps[0].state).toBe('already');
  });

  it('dit pourquoi une étape n’a rien à publier', () => {
    const steps = planPublicationSteps(
      [node('gone'), node('old')],
      targets({ gone: null, old: { archived: true } }),
      leg,
    );
    expect(steps.map((s) => [s.state, s.reason])).toEqual([
      ['not-applicable', 'aucune contrepartie sur la cible'],
      ['not-applicable', 'archivé dans n8n'],
    ]);
  });
});

describe('déroulé d’une chaîne', () => {
  const steps = planPublicationSteps(
    [node('leaf'), node('mid', ['leaf']), node('root', ['mid'])],
    targets(),
    leg,
  );

  it('se termine seule quand tout est publié', () => {
    let run = startPublicationRun(steps);
    for (let i = nextPublicationStep(run); i !== -1; i = nextPublicationStep(run))
      run = recordPublished(run, i);
    expect(run.status).toBe('done');
    expect(run.steps.every((s) => s.state === 'done')).toBe(true);
  });

  it('s’arrête sur le premier refus sans toucher la suite', () => {
    let run = startPublicationRun(steps);
    run = recordPublished(run, 0);
    run = recordPublishFailure(run, 1, 'Please publish all referenced sub-workflows first');
    expect(run.status).toBe('paused');
    expect(nextPublicationStep(run)).toBe(-1);
    expect(run.steps.map((s) => s.state)).toEqual(['done', 'failed', 'pending']);
    expect(run.steps[1].reason).toMatch(/publish/);
  });

  it('reprend sur l’étape refusée', () => {
    const paused = recordPublishFailure(startPublicationRun(steps), 0, 'refus');
    const resumed = resumePublicationRun(paused);
    expect(resumed.status).toBe('running');
    expect(nextPublicationStep(resumed)).toBe(0);
    const done = recordPublished(resumed, 0);
    expect(done.steps[0].reason).toBeUndefined();
  });

  it('passe l’étape refusée et continue avec la suivante', () => {
    const skipped = skipPublicationStep(recordPublishFailure(startPublicationRun(steps), 1, 'refus'));
    expect(skipped.steps[1].state).toBe('skipped');
    expect(nextPublicationStep(skipped)).toBe(0);
  });

  it('passer la dernière étape termine la chaîne', () => {
    let run = startPublicationRun(steps);
    run = recordPublished(recordPublished(run, 0), 1);
    run = skipPublicationStep(recordPublishFailure(run, 2, 'refus'));
    expect(run.status).toBe('done');
  });

  it('une chaîne abandonnée ne joue plus rien', () => {
    const run = abandonPublicationRun(recordPublishFailure(startPublicationRun(steps), 0, 'refus'));
    expect(run.status).toBe('abandoned');
    expect(nextPublicationStep(resumePublicationRun(run))).toBe(-1);
  });

  it('une chaîne sans rien à publier est terminée d’emblée', () => {
    const run = startPublicationRun(planPublicationSteps([node('a', [], false)], targets(), leg));
    expect(run.status).toBe('done');
  });
});

describe('isPublished', () => {
  const wf = (extra: Partial<N8nWorkflow>): N8nWorkflow => ({
    name: 'x',
    nodes: [],
    connections: {},
    ...extra,
  });
  it('lit la version publiée sur un n8n à versions', () => {
    expect(isPublished(wf({ activeVersionId: 'v1', active: false }))).toBe(true);
    expect(isPublished(wf({ activeVersionId: null, active: true }))).toBe(false);
  });
  it('lit l’état actif sur un n8n sans versions', () => {
    expect(isPublished(wf({ active: true }))).toBe(true);
    expect(isPublished(wf({ active: false }))).toBe(false);
  });
});
