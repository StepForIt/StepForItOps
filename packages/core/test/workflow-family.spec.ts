import { describe, expect, it } from 'vitest';
import { envFamilyKey, workflowFamilyKey, workflowFamilyName } from '../src/domain/workflow-family';

describe('workflowFamilyName', () => {
  it('strips the env suffix, whatever its form', () => {
    expect(workflowFamilyName('FORM -> Airtable - DEV')).toBe('FORM -> Airtable');
    expect(workflowFamilyName('FORM -> Airtable (prod)')).toBe('FORM -> Airtable');
    expect(workflowFamilyName('Facturation PREPROD')).toBe('Facturation');
  });

  it('strips the archived prefix', () => {
    expect(workflowFamilyName('[ARCHIVED] Facturation - PROD')).toBe('Facturation');
  });

  it('strips the version the team keeps in the name', () => {
    expect(workflowFamilyName('FORM -> Airtable (1.2.3) - DEV')).toBe('FORM -> Airtable');
  });

  it('keeps a name that is only an env word', () => {
    expect(workflowFamilyName('PROD')).toBe('PROD');
  });

  it('leaves an ordinary name untouched', () => {
    expect(workflowFamilyName('Sync Qonto')).toBe('Sync Qonto');
  });
});

describe('workflowFamilyKey', () => {
  it('groups the same workflow across envs and archiving', () => {
    const key = workflowFamilyKey('FORM -> Airtable (1.2.3) - DEV');
    expect(workflowFamilyKey('FORM -> Airtable (1.2.3) - PROD')).toBe(key);
    expect(workflowFamilyKey('[ARCHIVED] form -> airtable  (1.2.3) (prod)')).toBe(key);
  });

  // Deux envs sont rarement au même numéro : c'est justement l'écart que la
  // promotion vient combler, il ne doit pas les rendre étrangers l'un à l'autre.
  it('groups two envs that disagree on the version', () => {
    expect(workflowFamilyKey('FORM -> Airtable (1.1.0) - PROD')).toBe(
      workflowFamilyKey('FORM -> Airtable (1.2.3) - DEV'),
    );
  });

  it('keeps distinct workflows apart', () => {
    expect(workflowFamilyKey('FORM -> Airtable - DEV')).not.toBe(workflowFamilyKey('FORM -> Notion - DEV'));
  });
});

describe('envFamilyKey', () => {
  it('pairs two exemplars of the same env whose version numbers disagree', () => {
    // La dev est en avance d'une promotion : c'est la situation ordinaire, pas un
    // autre workflow. Sans ça la promotion créait un second exemplaire en prod.
    expect(envFamilyKey('Send Sms + Email (1.1.4) - PROD')).toBe(
      envFamilyKey('Send Sms + Email (1.2.1) - PROD'),
    );
  });

  it('keeps two envs of the same workflow apart', () => {
    expect(envFamilyKey('Send Sms + Email (1.2.1) - DEV')).not.toBe(
      envFamilyKey('Send Sms + Email (1.2.1) - PROD'),
    );
  });

  it('reads the env from the name alone', () => {
    expect(envFamilyKey('Send Sms + Email')).toBe(envFamilyKey('Send Sms + Email (2.0.0)'));
  });
});
