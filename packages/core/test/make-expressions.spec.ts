import { describe, expect, it } from 'vitest';
import { referencedModuleIds } from '../src/domain/make/make-expressions';

describe('referencedModuleIds', () => {
  it('lit un renvoi simple', () => {
    expect(referencedModuleIds(['{{2.email}}'])).toEqual([2]);
  });

  it('lit les formes tordues : colonne par index, longueur de bundle, tableau', () => {
    expect(
      referencedModuleIds(['{{1.`0`}}', '{{6.__IMTLENGTH__}}', '{{4.choices[].message}}']).sort(),
    ).toEqual([1, 4, 6]);
  });

  it('lit les renvois passés à une fonction', () => {
    expect(referencedModuleIds(['{{split(1.`1`; space)}}']).sort()).toEqual([1]);
  });

  it("ne prend pas un nombre d'une fonction pour un module : c'est le faux positif à éviter", () => {
    expect(referencedModuleIds(['{{formatDate(now; "YYYY")}}'])).toEqual([]);
    expect(referencedModuleIds(['{{now}}', 'texte sans expression'])).toEqual([]);
  });

  it('dédoublonne', () => {
    expect(referencedModuleIds(['{{2.a}} et {{2.b}}'])).toEqual([2]);
  });
});
