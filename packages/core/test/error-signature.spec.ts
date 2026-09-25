import { describe, expect, it } from 'vitest';
import { NO_DETAIL_PATTERN, errorSignature, normalizeErrorMessage } from '../src/domain/error-signature';

describe('normalizeErrorMessage', () => {
  it('efface les identifiants variables', () => {
    expect(normalizeErrorMessage('Record recA1b2C3d4E5f6G7 not found')).toBe('Record <id> not found');
    expect(normalizeErrorMessage('Workflow 3f0b1c2d-4e5f-6a7b-8c9d-0e1f2a3b4c5d failed')).toBe(
      'Workflow <uuid> failed',
    );
  });

  it('efface urls, emails, dates et nombres', () => {
    expect(normalizeErrorMessage('POST https://api.airtable.com/v0/x failed')).toBe('POST <url> failed');
    expect(normalizeErrorMessage('No user for contact@example.com')).toBe('No user for <email>');
    expect(normalizeErrorMessage('Expired at 2026-08-07T10:12:33Z')).toBe('Expired at <date>');
    expect(normalizeErrorMessage('Timeout after 30000 ms on item 4')).toBe(
      'Timeout after <n> ms on item <n>',
    );
  });

  it('normalise les espaces et tronque les messages fleuve', () => {
    expect(normalizeErrorMessage("  trop   d'espaces \n ici ")).toBe("trop d'espaces ici");
    expect(normalizeErrorMessage('x'.repeat(400))).toHaveLength(300);
  });
});

describe('errorSignature', () => {
  const base = { externalWorkflowId: 'wf1', failedNode: 'Airtable' };

  it('regroupe deux erreurs qui ne diffèrent que par leurs valeurs', () => {
    const a = errorSignature({ ...base, message: 'Record rec111aaa222bbb not found (row 12)' });
    const b = errorSignature({ ...base, message: 'Record rec999zzz888yyy not found (row 47)' });
    expect(a.key).toBe(b.key);
    expect(a.pattern).toBe('Record <id> not found (row <n>)');
  });

  it('sépare les workflows, les nœuds et les messages différents', () => {
    const reference = errorSignature({ ...base, message: 'Bad credentials' });
    expect(errorSignature({ ...base, externalWorkflowId: 'wf2', message: 'Bad credentials' }).key).not.toBe(
      reference.key,
    );
    expect(errorSignature({ ...base, failedNode: 'Notion', message: 'Bad credentials' }).key).not.toBe(
      reference.key,
    );
    expect(errorSignature({ ...base, message: 'Rate limit' }).key).not.toBe(reference.key);
  });

  it('regroupe ensemble les exécutions dont le détail est perdu', () => {
    const a = errorSignature({ externalWorkflowId: 'wf1', failedNode: null, message: null });
    const b = errorSignature({ externalWorkflowId: 'wf1' });
    expect(a.key).toBe(b.key);
    expect(a.pattern).toBe(NO_DETAIL_PATTERN);
  });
});
