import { msg } from '../i18n';
import { gestureOptions, MACRO_GESTURES, MacroAction, stepLabel } from './release-macro';

/**
 * Une procédure qui voyage : exportée d'une plateforme, importée sur une autre
 * (ou rejouée après une restauration). Le fichier ne porte NI id, NI auteur, NI
 * état d'enregistrement — ce qui identifie une procédure ailleurs est son nom,
 * et ce qui la fait tourner est ses étapes, rangées par workflow métier et par env.
 */

export const PROCEDURE_BUNDLE_KIND = 'stepforit-ops/release-procedures';
export const PROCEDURE_BUNDLE_VERSION = 1;

export interface BundleStep {
  kind: 'auto' | 'manual';
  action: MacroAction | null;
  familyKey: string | null;
  familyName: string | null;
  sourceEnv: string | null;
  targetEnv: string | null;
  options: Record<string, boolean> | null;
  label: string;
  note: string | null;
}

export interface BundleProcedure {
  name: string;
  /** Le saut enregistré, celui que le rejeu décale. */
  sourceEnv: string | null;
  targetEnv: string | null;
  steps: BundleStep[];
}

export interface ProcedureBundle {
  kind: typeof PROCEDURE_BUNDLE_KIND;
  version: number;
  exportedAt: string;
  procedures: BundleProcedure[];
}

export function buildProcedureBundle(
  procedures: BundleProcedure[],
  exportedAt = new Date(),
): ProcedureBundle {
  return {
    kind: PROCEDURE_BUNDLE_KIND,
    version: PROCEDURE_BUNDLE_VERSION,
    exportedAt: exportedAt.toISOString(),
    procedures: procedures.map((procedure) => ({
      name: procedure.name,
      sourceEnv: procedure.sourceEnv,
      targetEnv: procedure.targetEnv,
      steps: procedure.steps.map((step) => ({
        kind: step.kind,
        action: step.action,
        familyKey: step.familyKey,
        familyName: step.familyName,
        sourceEnv: step.sourceEnv,
        targetEnv: step.targetEnv,
        options: step.options,
        label: step.label,
        note: step.note,
      })),
    })),
  };
}

export type ParsedProcedureBundle = { ok: true; bundle: ProcedureBundle } | { ok: false; reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): string | null | undefined => {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value.trim() || null : undefined;
};

const isMacroAction = (value: unknown): value is MacroAction =>
  typeof value === 'string' && value in MACRO_GESTURES;

/**
 * Relit une étape telle qu'un fichier la porte. Le libellé d'un geste n'est pas
 * repris du fichier mais RECALCULÉ (`stepLabel`) : il se lit dans la langue de la
 * plateforme qui importe, pas de celle qui a exporté. Celui d'une étape manuelle,
 * écrit par un humain, est recopié tel quel.
 */
function parseStep(input: unknown, position: number): BundleStep | string {
  const at = (reason: string) => msg('release.importStepInvalid', { position: position + 1, reason });
  if (!isRecord(input)) return at(msg('release.importNotAnObject'));
  const note = optionalString(input.note);
  if (note === undefined) return at(msg('release.importBadField', { field: 'note' }));

  if (input.kind === 'manual') {
    const label = optionalString(input.label);
    if (!label) return at(msg('release.sayWhatToDo'));
    return {
      kind: 'manual',
      action: null,
      familyKey: null,
      familyName: null,
      sourceEnv: null,
      targetEnv: null,
      options: null,
      label,
      note,
    };
  }
  if (input.kind !== 'auto') return at(msg('release.importBadField', { field: 'kind' }));
  if (!isMacroAction(input.action)) return at(msg('release.unknownGesture'));
  const familyKey = optionalString(input.familyKey);
  const familyName = optionalString(input.familyName);
  if (!familyKey || !familyName) return at(msg('release.pickWorkflow'));
  const sourceEnv = optionalString(input.sourceEnv);
  const targetEnv = optionalString(input.targetEnv);
  if (sourceEnv === undefined) return at(msg('release.importBadField', { field: 'sourceEnv' }));
  if (targetEnv === undefined) return at(msg('release.importBadField', { field: 'targetEnv' }));
  if (MACRO_GESTURES[input.action].needsEnv && !targetEnv) return at(msg('release.pickTargetEnv'));
  const options = isRecord(input.options) ? gestureOptions(input.action, input.options) : {};
  return {
    kind: 'auto',
    action: input.action,
    familyKey,
    familyName,
    sourceEnv,
    targetEnv,
    options,
    label: stepLabel({ action: input.action, familyName, targetEnv, sourceEnv }),
    note,
  };
}

function parseProcedure(input: unknown, index: number): BundleProcedure | string {
  const at = (reason: string) => msg('release.importProcedureInvalid', { position: index + 1, reason });
  if (!isRecord(input)) return at(msg('release.importNotAnObject'));
  const name = optionalString(input.name);
  if (!name) return at(msg('release.nameRequired'));
  const sourceEnv = optionalString(input.sourceEnv);
  const targetEnv = optionalString(input.targetEnv);
  if (sourceEnv === undefined) return at(msg('release.importBadField', { field: 'sourceEnv' }));
  if (targetEnv === undefined) return at(msg('release.importBadField', { field: 'targetEnv' }));
  if (!Array.isArray(input.steps)) return at(msg('release.importBadField', { field: 'steps' }));
  const steps: BundleStep[] = [];
  for (const [position, raw] of input.steps.entries()) {
    const step = parseStep(raw, position);
    if (typeof step === 'string') return at(step);
    steps.push(step);
  }
  return { name, sourceEnv, targetEnv, steps };
}

/** Un fichier déposé par un humain : tout est vérifié, et le premier défaut est nommé. */
export function parseProcedureBundle(input: unknown): ParsedProcedureBundle {
  if (!isRecord(input)) return { ok: false, reason: msg('release.importNotAnObject') };
  if (input.kind !== PROCEDURE_BUNDLE_KIND) return { ok: false, reason: msg('release.importWrongKind') };
  if (typeof input.version !== 'number' || input.version > PROCEDURE_BUNDLE_VERSION) {
    return { ok: false, reason: msg('release.importNewerVersion') };
  }
  if (!Array.isArray(input.procedures) || input.procedures.length === 0) {
    return { ok: false, reason: msg('release.importEmpty') };
  }
  const procedures: BundleProcedure[] = [];
  for (const [index, raw] of input.procedures.entries()) {
    const procedure = parseProcedure(raw, index);
    if (typeof procedure === 'string') return { ok: false, reason: procedure };
    procedures.push(procedure);
  }
  return {
    ok: true,
    bundle: {
      kind: PROCEDURE_BUNDLE_KIND,
      version: input.version,
      exportedAt: typeof input.exportedAt === 'string' ? input.exportedAt : '',
      procedures,
    },
  };
}

/** Quand une procédure du fichier porte le nom d'une procédure déjà là. */
export type ImportConflict = 'skip' | 'replace' | 'duplicate';

export interface ProcedureImportRow {
  name: string;
  /** Le nom sous lequel elle sera écrite : celui du fichier, ou un nom libre en mode `duplicate`. */
  importName: string;
  steps: number;
  /** `existing` : une procédure de ce nom est déjà là. */
  status: 'new' | 'existing';
  outcome: 'create' | 'replace' | 'skip';
  /** Ce qui ne bloque pas mais se lit avant d'importer : env non déclaré, workflow inconnu du miroir. */
  warnings: string[];
}

/** « X » déjà pris ⇒ « X (2) », puis « X (3) »… */
function freeName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Ce que l'import fera, procédure par procédure, AVANT de l'écrire. L'env d'une
 * étape est une convention locale : un fichier venu d'une plateforme à env
 * « recette » prévient qu'il n'est pas déclaré ici, sans refuser l'import — c'est
 * à l'arrivée qu'on déclare l'env ou qu'on corrige l'étape. De même, un workflow
 * métier absent du miroir n'est qu'un avertissement : il sera peut-être synchronisé demain.
 */
export function planProcedureImport(
  bundle: ProcedureBundle,
  existingNames: readonly string[],
  envIds: readonly string[],
  knownFamilyKeys: ReadonlySet<string> | null,
  onConflict: ImportConflict,
): ProcedureImportRow[] {
  const taken = new Set(existingNames);
  const declared = new Set(envIds);
  return bundle.procedures.map((procedure) => {
    const warnings: string[] = [];
    const envs = new Set<string>();
    const families = new Map<string, string>();
    for (const env of [procedure.sourceEnv, procedure.targetEnv]) if (env) envs.add(env);
    for (const step of procedure.steps) {
      for (const env of [step.sourceEnv, step.targetEnv]) if (env) envs.add(env);
      if (step.familyKey && step.familyName) families.set(step.familyKey, step.familyName);
    }
    for (const env of envs) {
      if (!declared.has(env)) warnings.push(msg('release.importUnknownEnv', { env: env.toUpperCase() }));
    }
    if (knownFamilyKeys) {
      for (const [key, name] of families) {
        if (!knownFamilyKeys.has(key)) warnings.push(msg('release.importUnknownWorkflow', { name }));
      }
    }

    const existing = taken.has(procedure.name);
    const outcome = !existing
      ? 'create'
      : onConflict === 'replace'
        ? 'replace'
        : onConflict === 'duplicate'
          ? 'create'
          : 'skip';
    const importName =
      existing && onConflict === 'duplicate' ? freeName(procedure.name, taken) : procedure.name;
    if (outcome !== 'skip') taken.add(importName);
    return {
      name: procedure.name,
      importName,
      steps: procedure.steps.length,
      status: existing ? 'existing' : 'new',
      outcome,
      warnings,
    };
  });
}
