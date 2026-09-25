import { apiGet, apiPost } from '../../lib/api';
import { applyRow, fetchPlan, fetchPreview } from '../../app/workflows/bulk-env/bulk-env-requests';
import type { BulkEnvAction, BulkSettings, PlannedRow, ReviewRow } from '../../app/workflows/bulk-env/types';
import type { EnvHop, MacroAction, ProcedureStep, StepRun } from './types';

/** Recopie de `replayEnv` / `replayTargetEnv` (`@nwm/core`, `release-macro.ts`) : le web ne dépend pas du core. */
export function replayEnv(env: string | null, recorded: EnvHop, replay: EnvHop): string | null {
  if (env === recorded.source) return replay.source;
  if (env === recorded.target) return replay.target;
  return env;
}

export function replayTargetEnv(
  action: MacroAction | null,
  env: string | null,
  recorded: EnvHop,
  replay: EnvHop,
): string | null {
  if (action === 'mark' && env === recorded.source) return env;
  return replayEnv(env, recorded, replay);
}

/** Décale un env d'une étape ; `target` : l'env VISÉ par le geste, et non celui de son exemplaire. */
export type EnvShift = (env: string | null, target?: { action: MacroAction | null }) => string | null;

const VERBS: Record<string, string> = {
  promote: 'Promouvoir',
  mark: 'Déclarer',
  duplicate: 'Dupliquer',
  switch: 'Rebrancher',
  'run-tests': 'Jouer les tests de',
  publish: 'Publier',
};

/** Le libellé d'une étape, envs décalés quand on rejoue. */
export function stepText(step: ProcedureStep, shift: EnvShift): string {
  if (step.kind === 'manual' || !step.action) return step.label;
  if (step.action === 'publish') {
    const env = shift(step.sourceEnv);
    return `${VERBS.publish} ${step.familyName}${env ? ` en ${env.toUpperCase()}` : ''}`;
  }
  const target = shift(step.targetEnv, step);
  const joint = step.action === 'mark' ? 'en' : step.action === 'switch' ? 'sur' : 'vers';
  return `${VERBS[step.action]} ${step.familyName}${target ? ` ${joint} ${target.toUpperCase()}` : ''}`;
}

interface SwitchPlan {
  hits: unknown[];
  unmapped: Array<{ provider: string; label?: string; key: string }>;
}

interface Exemplar {
  workflowId: string;
  active: boolean;
}

const resolveExemplar = (familyKey: string, env: string) =>
  apiGet<Exemplar>(
    `/release-procedures/resolve?familyKey=${encodeURIComponent(familyKey)}&env=${encodeURIComponent(env)}`,
  );

/**
 * Rebrancher change les données d'un workflow sans rien changer à ses nœuds : sur un
 * workflow actif, ou avec des ressources qu'aucun mapping ne couvre, c'est un humain
 * qui décide — comme dans l'assistant Environnements, qui arme le même avertissement.
 */
async function playSwitch(familyKey: string, env: string, targetEnv: string): Promise<StepRun> {
  const { workflowId, active } = await resolveExemplar(familyKey, env);
  const plan = await apiPost<SwitchPlan>(`/env-switcher/preview/${workflowId}`, { targetEnv });
  if (plan.hits.length === 0) return { state: 'done', summary: 'déjà branché' };

  const apply = async (): Promise<string> => {
    const { applied } = await apiPost<{ applied: number }>(`/env-switcher/apply/${workflowId}`, {
      targetEnv,
    });
    return `${applied} remplacement${applied > 1 ? 's' : ''}`;
  };
  const decisions = [
    ...(active ? [`Workflow ACTIF : il tournera sur les données ${targetEnv.toUpperCase()}`] : []),
    ...plan.unmapped.map((resource) => `Sans mapping, reste en place : ${resource.label ?? resource.key}`),
  ];
  if (decisions.length > 0) return { state: 'waiting', decisions, resume: apply };
  return { state: 'done', summary: await apply() };
}

interface PausedRun {
  status: string;
  steps: Array<{ name: string; state: string; reason?: string }>;
}

interface TestRunResult {
  results: Array<{ status: 'passed' | 'failed' | 'error' }>;
}

/**
 * Joue une étape automatique. Elle repasse par les MÊMES routes qu'un lot de la
 * vue groupée — plan, aperçu, application — donc par les mêmes garde-fous : ce
 * que l'aperçu laisse à décider n'est jamais tranché ici, l'étape attend un humain.
 */
export async function playAutoStep(step: ProcedureStep, shift: EnvShift): Promise<StepRun> {
  if (!step.action || !step.familyKey) return { state: 'failed', error: 'Étape incomplète' };

  if (step.action === 'run-tests' || step.action === 'publish') {
    const env = shift(step.sourceEnv);
    if (!env) return { state: 'failed', error: "Env du workflow inconnu à l'enregistrement" };
    const { workflowId } = await resolveExemplar(step.familyKey, env);
    if (step.action === 'publish') {
      const { alreadyPublished } = await apiPost<{ alreadyPublished: boolean }>(
        `/workflows/${workflowId}/publish`,
      );
      return { state: 'done', summary: alreadyPublished ? 'déjà publié' : 'publié' };
    }
    const { results } = await apiPost<TestRunResult>(`/tester/cases/run-all/${workflowId}`);
    const red = results.filter((result) => result.status !== 'passed').length;
    if (red > 0) return { state: 'failed', error: `${red} cas sur ${results.length} en échec` };
    return {
      state: 'done',
      summary: results.length ? `${results.length} cas verts` : 'aucun cas enregistré',
    };
  }

  if (step.action === 'switch') {
    const env = shift(step.sourceEnv);
    const targetEnv = shift(step.targetEnv, step);
    if (!env) return { state: 'failed', error: "Env du workflow inconnu à l'enregistrement" };
    if (!targetEnv) return { state: 'failed', error: 'Env cible inconnu' };
    return playSwitch(step.familyKey, env, targetEnv);
  }

  const action: BulkEnvAction = step.action;
  const options = step.options ?? {};
  const targetEnv = shift(step.targetEnv, step);
  if (!targetEnv) return { state: 'failed', error: 'Env cible inconnu' };
  const settings: BulkSettings = {
    sourceEnv: action === 'mark' ? null : shift(step.sourceEnv),
    targetEnv,
    throughChain: options.throughChain ?? true,
    cascade: options.cascade ?? true,
    checkRemote: options.checkRemote ?? false,
    rename: options.rename ?? false,
    publishLikeSource: options.publishLikeSource ?? false,
  };
  const familyKey = step.familyKey;

  const [plan] = await fetchPlan(action, [familyKey], settings);
  if (!plan) return { state: 'failed', error: 'Rien à faire' };
  if (plan.status === 'skipped') {
    // Déjà fait : un rejeu joué deux fois doit passer la seconde, pas s'y arrêter.
    if (plan.code !== 'already-done' || !plan.exemplarId) return { state: 'failed', error: plan.reason };
    const exemplarId = plan.exemplarId;
    return {
      state: 'done',
      summary: 'déjà en place',
      redo:
        action === 'mark'
          ? async () => {
              await apiPost(`/env-switcher/mark/${exemplarId}`, { targetEnv, rename: settings.rename });
              return { state: 'done', summary: 'redéclaré' };
            }
          : // Refaire une copie qui existe, c'est la mettre à jour : une promotion vers elle, gates compris.
            () => playEnvGesture('promote', familyKey, settings),
    };
  }
  return playPlanned(action, plan, settings);
}

/** Plan, aperçu, application d'un geste d'environnement sur une famille. */
async function playEnvGesture(
  action: BulkEnvAction,
  familyKey: string,
  settings: BulkSettings,
): Promise<StepRun> {
  const [plan] = await fetchPlan(action, [familyKey], settings);
  if (!plan || plan.status === 'skipped') return { state: 'failed', error: plan?.reason ?? 'Rien à faire' };
  return playPlanned(action, plan, settings);
}

async function playPlanned(
  action: BulkEnvAction,
  plan: PlannedRow,
  settings: BulkSettings,
): Promise<StepRun> {
  const preview = await fetchPreview(action, plan, settings);
  const readiness = preview.data.readiness;
  if (readiness.status === 'blocked') return { state: 'failed', error: readiness.reasons.join(' · ') };

  const apply = async (force: boolean, confirmSkip: boolean): Promise<StepRun> => {
    const row: ReviewRow = {
      plan,
      preview,
      choices: { validated: true, force, confirmSkip },
      outcome: { state: 'running' },
    };
    const result = await applyRow(action, row, settings);
    const summary = [result.summary, result.warning].filter(Boolean).join(' · ');
    // Une publication en pause attend un humain : la reprendre, c'est rejouer l'étape refusée.
    if (result.pausedRun) {
      const runId = result.pausedRun.id;
      return {
        state: 'waiting',
        decisions: [result.pausedRun.reason],
        resume: async () => {
          const next = await apiPost<PausedRun>(`/env-switcher/publish-runs/${runId}/resume`);
          const refused = next.steps.find((step) => step.state === 'failed');
          if (next.status === 'paused')
            throw new Error(`« ${refused?.name} » : ${refused?.reason ?? 'refus de n8n'}`);
          return `${result.summary} · publié comme la source`;
        },
      };
    }
    return { state: 'done', summary };
  };
  const applied = async (force: boolean, confirmSkip: boolean): Promise<string> => {
    const run = await apply(force, confirmSkip);
    if (run.state === 'waiting') throw new Error(run.decisions?.join(' · '));
    return run.state === 'done' ? (run.summary ?? '') : '';
  };

  if (readiness.status === 'decide') {
    const codes = readiness.decisions.map((decision) => decision.code);
    return {
      state: 'waiting',
      decisions: readiness.decisions.map((decision) => decision.label),
      resume: () => applied(codes.includes('force'), codes.includes('confirm-skip')),
    };
  }
  return apply(false, false);
}
