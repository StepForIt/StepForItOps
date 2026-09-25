import { describe, expect, it } from 'vitest';
import {
  CHECK_CATALOG,
  CHECK_GROUPS,
  checkCodesOfGroup,
  enabledCodesOfModule,
  isModuleFullyDisabled,
  normalizeDisabled,
} from '../src/domain/check-catalog';
import {
  CheckProfileLike,
  decideSaveScope,
  resolveCheckProfile,
  sameSelection,
} from '../src/domain/check-profile';

describe('catalogue', () => {
  it('rattache chaque contrôle à un groupe déclaré', () => {
    const groups = new Set(CHECK_GROUPS.map((group) => group.id));
    for (const check of CHECK_CATALOG) expect(groups.has(check.group)).toBe(true);
  });

  it('écarte les codes hors catalogue et rend un ordre stable', () => {
    expect(normalizeDisabled(['orphan-node', 'inconnu', 'no-trigger', 'orphan-node'])).toEqual([
      'orphan-node',
      'no-trigger',
    ]);
    expect(normalizeDisabled(['no-trigger', 'orphan-node'])).toEqual(['orphan-node', 'no-trigger']);
  });

  it('sait quand un module entier est décoché', () => {
    const sticky = checkCodesOfGroup('sticky');
    const naming = checkCodesOfGroup('naming');
    expect(isModuleFullyDisabled(sticky, 'optimizer')).toBe(false);
    expect(isModuleFullyDisabled([...sticky, ...naming], 'optimizer')).toBe(true);
    expect(enabledCodesOfModule(sticky, 'optimizer')).toEqual(naming);
  });
});

describe('resolveCheckProfile', () => {
  const global: CheckProfileLike = { scope: 'global', targetId: '', disabled: ['no-trigger'] };
  const instance: CheckProfileLike = { scope: 'instance', targetId: 'i1', disabled: ['orphan-node'] };
  const family: CheckProfileLike = { scope: 'family', targetId: 'w1', disabled: ['js-ai'] };

  it('donne le périmètre le plus précis, sans fusionner', () => {
    expect(resolveCheckProfile([global, instance, family]).disabled).toEqual(['js-ai']);
    expect(resolveCheckProfile([global, instance]).disabled).toEqual(['orphan-node']);
  });

  it('sans profil, tout est actif', () => {
    const resolved = resolveCheckProfile([]);
    expect(resolved.disabled).toEqual([]);
    expect(resolved.source).toBeNull();
  });

  it('à précision égale (plusieurs groupes), le dernier modifié tranche', () => {
    const older: CheckProfileLike = {
      scope: 'group',
      targetId: 'g1',
      disabled: ['no-trigger'],
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const newer: CheckProfileLike = {
      scope: 'group',
      targetId: 'g2',
      disabled: ['orphan-node'],
      updatedAt: '2026-02-01T00:00:00Z',
    };
    expect(resolveCheckProfile([older, newer]).source?.targetId).toBe('g2');
  });
});

describe('sameSelection', () => {
  it('ignore l’ordre et les codes inconnus', () => {
    expect(sameSelection(['no-trigger', 'orphan-node'], ['orphan-node', 'no-trigger', 'zzz'])).toBe(true);
    expect(sameSelection(['no-trigger'], ['orphan-node'])).toBe(false);
  });
});

describe('decideSaveScope', () => {
  const none = { disabled: [], source: null };
  const noTwins = { group: 0, instance: 0, anywhere: 0 };

  it('ne fait rien quand la sélection est déjà celle qui s’applique', () => {
    const resolved = { disabled: ['js-ai'], source: null };
    expect(
      decideSaveScope({
        selection: ['js-ai'],
        resolved,
        hasAnyProfile: true,
        twinFamilies: noTwins,
        hasGroup: false,
      }),
    ).toEqual({ action: 'none' });
  });

  it('première configuration : elle devient celle de l’app', () => {
    const decision = decideSaveScope({
      selection: ['js-ai'],
      resolved: none,
      hasAnyProfile: false,
      twinFamilies: noTwins,
      hasGroup: false,
    });
    expect(decision).toMatchObject({ action: 'auto', scope: 'global' });
  });

  it('configuration suivante et différente : elle va sur le workflow', () => {
    const decision = decideSaveScope({
      selection: ['js-ai'],
      resolved: none,
      hasAnyProfile: true,
      twinFamilies: noTwins,
      hasGroup: true,
    });
    expect(decision).toMatchObject({ action: 'auto', scope: 'family' });
  });

  it('sélection déjà vue ailleurs : on propose de la remonter, au palier le plus précis', () => {
    const base = {
      selection: ['js-ai'],
      resolved: none,
      hasAnyProfile: true,
      hasGroup: true,
    } as const;
    expect(decideSaveScope({ ...base, twinFamilies: { group: 1, instance: 1, anywhere: 3 } })).toMatchObject({
      action: 'ask',
      suggested: 'group',
    });
    expect(decideSaveScope({ ...base, twinFamilies: { group: 0, instance: 2, anywhere: 3 } })).toMatchObject({
      action: 'ask',
      suggested: 'instance',
    });
    expect(decideSaveScope({ ...base, twinFamilies: { group: 0, instance: 0, anywhere: 1 } })).toMatchObject({
      action: 'ask',
      suggested: 'global',
    });
  });

  it('sans groupe, le palier groupe est sauté', () => {
    const decision = decideSaveScope({
      selection: ['js-ai'],
      resolved: none,
      hasAnyProfile: true,
      twinFamilies: { group: 2, instance: 2, anywhere: 2 },
      hasGroup: false,
    });
    expect(decision).toMatchObject({ action: 'ask', suggested: 'instance' });
  });
});
