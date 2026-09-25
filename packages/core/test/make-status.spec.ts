import { describe, expect, it } from 'vitest';
import { toExecutionStatus, toExecutionStatusFromLabel } from '../src/domain/make/make-status';

describe('toExecutionStatus', () => {
  it('1 = succès (le seul)', () => {
    expect(toExecutionStatus(1)).toBe('success');
  });

  it("2 (avertissement) compte comme une erreur : un module a échoué, c'est ce qu'on surveille", () => {
    expect(toExecutionStatus(2)).toBe('error');
  });

  it('3 = erreur', () => {
    expect(toExecutionStatus(3)).toBe('error');
  });

  it('un code inconnu ou absent vaut erreur, jamais succès', () => {
    expect(toExecutionStatus(undefined)).toBe('error');
    expect(toExecutionStatus(99)).toBe('error');
  });
});

describe('toExecutionStatusFromLabel', () => {
  it('traduit les statuts en toutes lettres du détail d exécution', () => {
    expect(toExecutionStatusFromLabel('SUCCESS')).toBe('success');
    expect(toExecutionStatusFromLabel('RUNNING')).toBe('running');
    expect(toExecutionStatusFromLabel('ERROR')).toBe('error');
    expect(toExecutionStatusFromLabel('WARNING')).toBe('error');
    expect(toExecutionStatusFromLabel(undefined)).toBe('error');
  });
});
