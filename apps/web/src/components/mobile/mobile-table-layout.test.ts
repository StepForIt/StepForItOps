import { describe, expect, it } from 'vitest';
import { planMobileColumns, toggleKey, valueAt } from './mobile-table-layout';

const col = (id: string, label: string, actions = false) => ({ id, label, actions });

describe('planMobileColumns', () => {
  const columns = [
    col('name', 'Nom'),
    col('env', 'Env'),
    col('status', 'Statut'),
    col('date', 'Modifié'),
    col('actions', '', true),
  ];

  it('prend la première colonne nommée pour titre, le reste en détail, les actions à part', () => {
    expect(planMobileColumns(columns)).toEqual({
      title: 'name',
      badges: [],
      details: ['env', 'status', 'date'],
      actions: ['actions'],
    });
  });

  it('saute une colonne sans nom en tête (icône, poignée) pour choisir le titre', () => {
    expect(planMobileColumns([col('icon', ''), ...columns]).title).toBe('name');
  });

  it('suit la mise en page déclarée : titre, badges sur la ligne repliée, colonnes masquées', () => {
    expect(planMobileColumns(columns, { title: 'env', badges: ['status'], hidden: ['date'] })).toEqual({
      title: 'env',
      badges: ['status'],
      details: ['name'],
      actions: ['actions'],
    });
  });

  it('ignore un nom de colonne inconnu plutôt que de perdre la ligne', () => {
    const plan = planMobileColumns(columns, { title: 'absent', badges: ['absent'] });
    expect(plan.title).toBe('name');
    expect(plan.badges).toEqual([]);
  });
});

describe('valueAt', () => {
  const record = { name: 'X', owner: { email: 'a@b.c' } };

  it('lit un champ simple ou un chemin', () => {
    expect(valueAt(record, 'name')).toBe('X');
    expect(valueAt(record, ['owner', 'email'])).toBe('a@b.c');
  });

  it('rend undefined sans dataIndex ou sur un chemin absent', () => {
    expect(valueAt(record, undefined)).toBeUndefined();
    expect(valueAt(record, ['owner', 'phone', 'x'])).toBeUndefined();
  });
});

describe('toggleKey', () => {
  it('ajoute une clé absente et retire une clé présente, sans toucher aux autres', () => {
    expect(toggleKey(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleKey(['a', 'b'], 'a')).toEqual(['b']);
  });
});
