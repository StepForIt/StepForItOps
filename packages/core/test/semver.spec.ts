import { describe, expect, it } from 'vitest';
import { bumpSemver, compareSemver, maxSemver, nextVersion, parseSemver } from '../src/domain/semver';

describe('parseSemver', () => {
  it('reads a three-part version', () => {
    expect(parseSemver('1.2.10')).toEqual({ major: 1, minor: 2, patch: 10 });
    expect(parseSemver(' 0.0.1 ')).toEqual({ major: 0, minor: 0, patch: 1 });
  });

  it('rejects anything else', () => {
    expect(parseSemver('1.2')).toBeNull();
    expect(parseSemver('v1.2.3')).toBeNull();
    expect(parseSemver('1.2.3-rc1')).toBeNull();
    expect(parseSemver(null)).toBeNull();
  });
});

describe('compareSemver', () => {
  it('compares digit by digit, not as text', () => {
    const cmp = (a: string, b: string) => compareSemver(parseSemver(a)!, parseSemver(b)!);
    expect(cmp('1.2.10', '1.2.9')).toBeGreaterThan(0);
    expect(cmp('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(cmp('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(cmp('1.2.3', '1.2.3')).toBe(0);
  });
});

describe('maxSemver', () => {
  it('ignores unreadable values', () => {
    expect(maxSemver(['1.2.3', null, 'brouillon', '1.10.0'])).toBe('1.10.0');
  });

  it('is null when nothing is readable', () => {
    expect(maxSemver([null, undefined, ''])).toBeNull();
  });
});

describe('bumpSemver', () => {
  it('resets the digits below', () => {
    const v = parseSemver('1.2.10')!;
    expect(bumpSemver(v, 'patch')).toEqual({ major: 1, minor: 2, patch: 11 });
    expect(bumpSemver(v, 'minor')).toEqual({ major: 1, minor: 3, patch: 0 });
    expect(bumpSemver(v, 'major')).toEqual({ major: 2, minor: 0, patch: 0 });
  });
});

describe('nextVersion', () => {
  it('starts at 1.0.0 when no exemplar is versioned, whatever the level', () => {
    // Le parc existant : aucun workflow ne porte de numéro, la première promotion
    // en pose un. Ce n'est pas un incrément — il n'y a rien à incrémenter.
    expect(nextVersion([null, undefined], 'patch')).toBe('1.0.0');
    expect(nextVersion([null, undefined], 'minor')).toBe('1.0.0');
    expect(nextVersion([null, undefined], 'major')).toBe('1.0.0');
    // Une valeur illisible laissée à la main ne fait pas repartir de zéro non plus.
    expect(nextVersion(['brouillon', 'v2'], 'patch')).toBe('1.0.0');
  });

  it('picks the versioned exemplar up even when its siblings have none', () => {
    // Deuxième promotion d'une famille : seul l'env déjà promu porte un numéro.
    expect(nextVersion([null, '1.0.0', null], 'patch')).toBe('1.0.1');
  });

  it('bumps the highest of the path, not the source alone', () => {
    // dev 1.2.10 promue vers une prod en 1.2.10 : tout le chemin passe en 1.2.11.
    expect(nextVersion(['1.2.10', '1.2.10'], 'patch')).toBe('1.2.11');
    // Une preprod plus avancée que la source ne se fait pas rejouer son numéro.
    expect(nextVersion(['1.2.10', '1.3.0', null], 'patch')).toBe('1.3.1');
  });
});
