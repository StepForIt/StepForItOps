import { describe, expect, it } from 'vitest';
import {
  isWorkflowArchived,
  withArchivedPrefix,
  withoutArchivedPrefix,
} from '../src/domain/workflow-archive';

describe('isWorkflowArchived', () => {
  it('detects the archived tag (case-insensitive)', () => {
    expect(isWorkflowArchived('Facturation', ['archived'])).toBe(true);
    expect(isWorkflowArchived('Facturation', ['ARCHIVED', 'crm'])).toBe(true);
  });

  it('detects the name prefix', () => {
    expect(isWorkflowArchived('[ARCHIVED] Facturation', [])).toBe(true);
  });

  it('returns false otherwise', () => {
    expect(isWorkflowArchived('Facturation', ['crm'])).toBe(false);
    expect(isWorkflowArchived('Archives comptables', [])).toBe(false);
  });
});

describe('withArchivedPrefix / withoutArchivedPrefix', () => {
  it('adds the prefix once', () => {
    expect(withArchivedPrefix('Facturation')).toBe('[ARCHIVED] Facturation');
    expect(withArchivedPrefix('[ARCHIVED] Facturation')).toBe('[ARCHIVED] Facturation');
  });

  it('removes the prefix', () => {
    expect(withoutArchivedPrefix('[ARCHIVED] Facturation')).toBe('Facturation');
    expect(withoutArchivedPrefix('[ARCHIVED]Facturation')).toBe('Facturation');
    expect(withoutArchivedPrefix('Facturation')).toBe('Facturation');
  });
});
