import { apiPost } from '../../../lib/api';
import {
  BulkEnvAction,
  BulkPlanRow,
  BulkPreview,
  BulkSettings,
  DuplicatePreview,
  PlannedRow,
  PromotePreview,
  ReviewRow,
} from './types';

/**
 * Les appels d'un lot : le plan, puis — ligne par ligne — les MÊMES routes que la
 * page d'un workflow. Aucun geste n'a de version « de masse » côté API : un lot
 * porte ainsi exactement les gardes d'un workflow seul.
 */

export function fetchPlan(action: BulkEnvAction, familyKeys: string[], settings: BulkSettings) {
  return apiPost<BulkPlanRow[]>('/env-switcher/bulk/plan', {
    action,
    familyKeys,
    sourceEnv: settings.sourceEnv,
    targetEnv: settings.targetEnv,
    fallbackInstanceId: settings.fallbackInstanceId,
  });
}

const promoteBody = (row: PlannedRow, settings: BulkSettings) => ({
  targetInstanceId: row.targetInstanceId,
  targetEnv: row.targetEnv,
  cascade: settings.cascade,
  throughChain: settings.throughChain,
  checkRemote: settings.checkRemote,
  publishLikeSource: settings.publishLikeSource,
});

export async function fetchPreview(
  action: BulkEnvAction,
  row: PlannedRow,
  settings: BulkSettings,
): Promise<BulkPreview> {
  switch (action) {
    case 'promote':
      return {
        kind: 'promote',
        data: await apiPost<PromotePreview>(
          `/env-switcher/promote/${row.sourceId}/preview`,
          promoteBody(row, settings),
        ),
      };
    case 'duplicate':
      return {
        kind: 'duplicate',
        data: await apiPost<DuplicatePreview>(`/env-switcher/duplicate/${row.sourceId}/preview`, {
          targetEnv: row.targetEnv,
        }),
      };
    case 'mark':
      // Déclarer ne touche à aucune donnée : il n'y a rien à lire avant.
      return {
        kind: 'mark',
        data: {
          sourceName: row.sourceName,
          changes: [
            `tag env:${row.targetEnv}`,
            ...(settings.rename ? [`« ${row.sourceName} » suffixé par ${row.targetEnv.toUpperCase()}`] : []),
          ],
          readiness: { status: 'ready', decisions: [], reasons: [] },
        },
      };
  }
}

interface PromoteResult {
  mode: 'create' | 'update';
  targetName: string;
  version?: string;
  cascaded: Array<{ targetName: string }>;
  through?: Array<{ env: string }>;
  renames?: Array<{
    renamed: string;
    status: 'renamed' | 'already' | 'no-marker' | 'failed';
    error?: string;
  }>;
  publication?: {
    id: string;
    status: string;
    steps: Array<{ name: string; state: string; reason?: string }>;
  };
  publicationError?: string;
}

interface DuplicateResult {
  newName: string;
  replacements: number;
  switched?: Array<{ nodeName: string; from: string; to: string }>;
  cascaded: Array<{ newName: string }>;
}

interface MarkResult {
  tags: string[];
  newName?: string;
}

/** Applique une ligne et rend la phrase du compte rendu — plus un avertissement quand c'est passé à moitié. */
export async function applyRow(
  action: BulkEnvAction,
  row: ReviewRow,
  settings: BulkSettings,
): Promise<{
  summary: string;
  detail?: string;
  warning?: string;
  /** Chaîne « publier comme la source » arrêtée sur un refus : à reprendre par un humain. */
  pausedRun?: { id: string; reason: string };
}> {
  const plan = row.plan as PlannedRow;
  switch (action) {
    case 'promote': {
      const preview = row.preview?.kind === 'promote' ? row.preview.data : undefined;
      const result = await apiPost<PromoteResult>(`/env-switcher/promote/${plan.sourceId}`, {
        ...promoteBody(plan, settings),
        force: row.choices.force,
        confirmSkip: row.choices.confirmSkip,
        bump: row.choices.bump ?? preview?.gates.version.level,
      });
      const failed = (result.renames ?? []).filter((rename) => rename.status === 'failed');
      const refused = result.publication?.steps.find((step) => step.state === 'failed');
      const pausedRun =
        result.publication?.status === 'paused'
          ? {
              id: result.publication.id,
              reason: `publication en pause sur « ${refused?.name} » : ${refused?.reason ?? 'refus de n8n'}`,
            }
          : undefined;
      const unpublished =
        pausedRun?.reason ?? (result.publicationError && `publication à faire : ${result.publicationError}`);
      return {
        pausedRun,
        summary:
          (result.mode === 'update' ? 'écrasé' : 'créé') + (result.version ? ` · v${result.version}` : ''),
        detail: [
          `« ${result.targetName} »`,
          result.through?.length
            ? `passé par ${result.through.map((s) => s.env.toUpperCase()).join(', ')}`
            : '',
          result.cascaded.length
            ? `sous-workflows créés : ${result.cascaded.map((c) => c.targetName).join(', ')}`
            : '',
        ]
          .filter(Boolean)
          .join(' · '),
        warning:
          [
            failed.length > 0
              ? `nom n8n non mis à jour : ${failed.map((rename) => rename.error ?? rename.renamed).join(' ; ')}`
              : '',
            unpublished || '',
          ]
            .filter(Boolean)
            .join(' · ') || undefined,
      };
    }
    case 'duplicate': {
      const result = await apiPost<DuplicateResult>(`/env-switcher/duplicate/${plan.sourceId}`, {
        targetEnv: plan.targetEnv,
        cascade: settings.cascade,
      });
      const switched = result.switched ?? [];
      const detail = [
        switched.length > 0
          ? switched.map((row) => `${row.nodeName} : ${row.from} → ${row.to}`).join(' · ')
          : result.replacements > 0
            ? `${result.replacements} base(s)/table(s) remplacée(s)`
            : '',
        result.cascaded.length ? `copiés aussi : ${result.cascaded.map((c) => c.newName).join(', ')}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      return { summary: `copie « ${result.newName} »`, detail: detail || undefined };
    }
    case 'mark': {
      const result = await apiPost<MarkResult>(`/env-switcher/mark/${plan.sourceId}`, {
        targetEnv: plan.targetEnv,
        rename: settings.rename,
      });
      return {
        summary: `tag env:${plan.targetEnv}` + (result.newName ? `, renommé « ${result.newName} »` : ''),
      };
    }
  }
}
