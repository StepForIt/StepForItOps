import { describe, expect, it } from 'vitest';
import { compareSnapshots, extractExecutionSnapshot, normalizeSnapshot } from '../src/domain/test-snapshot';

describe('normalizeSnapshot', () => {
  it('neutralise les parties variables des chaînes, pas les nombres', () => {
    const normalized = normalizeSnapshot({
      id: 'rec8f3kD92mQx01a',
      recordWithoutDigits: 'recdywSDhUCmCJrQY',
      createdAt: '2026-08-20T10:00:00.000Z',
      url: 'https://api.example.com/x/42',
      amount: 129.9,
    });
    expect(normalized).toEqual({
      id: '<id>',
      // Un id Airtable sans le moindre chiffre : reconnu à son préfixe, pas à sa forme.
      recordWithoutDigits: '<id>',
      createdAt: '<date>',
      url: '<url>',
      amount: 129.9,
    });
  });
});

describe('compareSnapshots', () => {
  it('matche deux sorties de même forme malgré ids et dates différents', () => {
    const a = [{ id: 'recAAA111222333', date: '2026-08-19T08:00:00Z', status: 'paid' }];
    const b = [{ id: 'recBBB444555666', date: '2026-08-20T09:30:00Z', status: 'paid' }];
    expect(compareSnapshots(a, b).match).toBe(true);
  });

  it('nomme la nature de chaque écart et la dit en clair', () => {
    const result = compareSnapshots([{ status: 'paid', total: 2 }], [{ status: 'pending', label: 'x' }]);
    expect(result.match).toBe(false);

    const changed = result.diffs.find((d) => d.field === 'status');
    expect(changed?.kind).toBe('value');
    expect(changed?.message).toContain('"pending"');
    expect(changed?.message).toContain('"paid"');

    expect(result.diffs.find((d) => d.field === 'total')?.kind).toBe('missing');
    expect(result.diffs.find((d) => d.field === 'label')?.kind).toBe('extra');
    expect(result.summary).toContain('3 écarts');

    const sizes = compareSnapshots([1, 2], [1]);
    expect(sizes.diffs[0].kind).toBe('count');
    expect(sizes.diffs[0].message).toContain('élément');
  });

  it('distingue un type différent d’une valeur différente', () => {
    const result = compareSnapshots([{ total: 12 }], [{ total: '12' }]);
    expect(result.diffs[0].kind).toBe('type');
    expect(result.diffs[0].message).toContain('texte');
  });

  it('signale l’artefact quand la partie variable n’est reconnue que d’un côté', () => {
    // Une référence longue sans chiffre échappe au normaliseur, l'autre non : ce
    // n'est pas la donnée qui diverge, c'est la comparaison — et ça doit se lire.
    const result = compareSnapshots([{ ref: 'ABCDEFGHIJKLMNO' }], [{ ref: 'ABCDEF1234567890' }]);
    expect(result.diffs[0].kind).toBe('normalization');
    expect(result.summary).toContain('artefact');
  });
});

describe('extractExecutionSnapshot', () => {
  const executionData = {
    resultData: {
      lastNodeExecuted: 'Set Result',
      runData: {
        Webhook: [{ data: { main: [[{ json: { headers: { host: 'x' }, body: { email: 'a@b.co' } } }]] } }],
        'Set Result': [{ data: { main: [[{ json: { ok: true } }, { json: { ok: false } }]] } }],
      },
    },
  };

  it('extrait le payload du webhook et la sortie du dernier nœud', () => {
    const snapshot = extractExecutionSnapshot(executionData, 'Webhook');
    expect(snapshot.lastNode).toBe('Set Result');
    expect(snapshot.items).toEqual([{ ok: true }, { ok: false }]);
    expect(snapshot.webhookPayload).toEqual({ email: 'a@b.co' });
  });

  it('reste muet sur des données illisibles', () => {
    expect(extractExecutionSnapshot(null).items).toEqual([]);
    expect(extractExecutionSnapshot('pas du json').lastNode).toBeNull();
  });
});
