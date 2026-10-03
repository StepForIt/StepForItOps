import { describe, expect, it } from 'vitest';
import {
  buildProcedureBundle,
  BundleProcedure,
  parseProcedureBundle,
  planProcedureImport,
  PROCEDURE_BUNDLE_KIND,
} from '../src/domain/release-procedure-bundle';

const procedure: BundleProcedure = {
  name: 'Release septembre',
  sourceEnv: 'dev',
  targetEnv: 'preprod',
  steps: [
    {
      kind: 'auto',
      action: 'promote',
      familyKey: 'facturation',
      familyName: 'Facturation',
      sourceEnv: 'dev',
      targetEnv: 'preprod',
      options: { cascade: true },
      label: 'Promouvoir Facturation vers PREPROD',
      note: 'vérifier le diff',
    },
    {
      kind: 'manual',
      action: null,
      familyKey: null,
      familyName: null,
      sourceEnv: null,
      targetEnv: null,
      options: null,
      label: 'Créer la credential Stripe',
      note: null,
    },
  ],
};

describe('bundle de procédures', () => {
  it("s'exporte puis se relit à l'identique, sans id ni auteur", () => {
    const bundle = buildProcedureBundle([procedure], new Date('2026-10-01T00:00:00Z'));
    expect(bundle.kind).toBe(PROCEDURE_BUNDLE_KIND);
    expect(JSON.stringify(bundle)).not.toMatch(/"id"|recordedBy/);
    const parsed = parseProcedureBundle(JSON.parse(JSON.stringify(bundle)));
    expect(parsed.ok && parsed.bundle.procedures).toEqual([procedure]);
  });

  it('écarte les décisions humaines glissées dans les options (force, bump)', () => {
    const bundle = buildProcedureBundle([
      { ...procedure, steps: [{ ...procedure.steps[0], options: { cascade: true, force: true } }] },
    ]);
    const parsed = parseProcedureBundle(bundle);
    expect(parsed.ok && parsed.bundle.procedures[0].steps[0].options).toEqual({ cascade: true });
  });

  it('recalcule le libellé d’un geste au lieu de reprendre celui du fichier', () => {
    const bundle = buildProcedureBundle([
      { ...procedure, steps: [{ ...procedure.steps[0], label: 'n’importe quoi' }] },
    ]);
    const parsed = parseProcedureBundle(bundle);
    expect(parsed.ok && parsed.bundle.procedures[0].steps[0].label).toContain('Facturation');
    expect(parsed.ok && parsed.bundle.procedures[0].steps[0].label).not.toBe('n’importe quoi');
  });

  it('refuse un fichier qui n’est pas un export de procédures, en le disant', () => {
    expect(parseProcedureBundle({ kind: 'autre', procedures: [] })).toMatchObject({ ok: false });
    expect(parseProcedureBundle(null)).toMatchObject({ ok: false });
    expect(
      parseProcedureBundle({ kind: PROCEDURE_BUNDLE_KIND, version: 99, procedures: [procedure] }),
    ).toMatchObject({ ok: false });
  });

  it('nomme l’étape fautive', () => {
    const bad = buildProcedureBundle([
      { ...procedure, steps: [procedure.steps[0], { ...procedure.steps[0], action: 'explode' as never }] },
    ]);
    const parsed = parseProcedureBundle(bad);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.reason).toMatch(/1.*2|2/);
  });

  it('exige un env cible pour un geste qui en a besoin', () => {
    const bad = buildProcedureBundle([{ ...procedure, steps: [{ ...procedure.steps[0], targetEnv: null }] }]);
    expect(parseProcedureBundle(bad).ok).toBe(false);
  });
});

describe("plan d'import", () => {
  const bundle = buildProcedureBundle([procedure, { ...procedure, name: 'Neuve' }]);
  const envs = ['dev', 'preprod', 'prod'];

  it('crée ce qui est neuf et saute un homonyme par défaut', () => {
    const rows = planProcedureImport(bundle, ['Release septembre'], envs, null, 'skip');
    expect(rows.map((row) => [row.name, row.status, row.outcome])).toEqual([
      ['Release septembre', 'existing', 'skip'],
      ['Neuve', 'new', 'create'],
    ]);
  });

  it('remplace ou duplique sous un nom libre selon le choix', () => {
    expect(planProcedureImport(bundle, ['Release septembre'], envs, null, 'replace')[0].outcome).toBe(
      'replace',
    );
    const dup = planProcedureImport(
      bundle,
      ['Release septembre', 'Release septembre (2)'],
      envs,
      null,
      'duplicate',
    );
    expect(dup[0]).toMatchObject({ outcome: 'create', importName: 'Release septembre (3)' });
  });

  it('prévient d’un env non déclaré ou d’un workflow inconnu, sans bloquer', () => {
    const [row] = planProcedureImport(bundle, [], ['dev', 'prod'], new Set(['autre']), 'skip');
    expect(row.outcome).toBe('create');
    expect(row.warnings.join(' ')).toMatch(/PREPROD/);
    expect(row.warnings.join(' ')).toMatch(/Facturation/);
  });
});
