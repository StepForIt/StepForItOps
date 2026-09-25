import { describe, expect, it } from 'vitest';
import {
  renameWithVersion,
  versionFromName,
  withoutVersionMarker,
} from '../src/domain/workflow-version-name';

describe('versionFromName', () => {
  it('reads the number the team keeps in the name, whatever its form', () => {
    expect(versionFromName('Send Sms + Email (1.1.4)')).toBe('1.1.4');
    expect(versionFromName('Send Sms + Email [1.1.4]')).toBe('1.1.4');
    expect(versionFromName('Send Sms + Email v1.1.4')).toBe('1.1.4');
  });

  it('reads it behind the env suffix and the archived prefix', () => {
    expect(versionFromName('Send Sms + Email (1.1.4) - PROD')).toBe('1.1.4');
    expect(versionFromName('[ARCHIVED] Send Sms + Email (1.1.4) (prod)')).toBe('1.1.4');
  });

  it('ignores what is not a version marker', () => {
    expect(versionFromName('Sync Qonto')).toBeNull();
    expect(versionFromName('Relance J+3')).toBeNull();
    // Un nombre nu en fin de nom est trop souvent autre chose qu'une version.
    expect(versionFromName('Import CSV 1.2.1')).toBeNull();
    expect(versionFromName('Facturation (2.0)')).toBeNull();
  });
});

describe('withoutVersionMarker', () => {
  it('drops the marker and nothing else', () => {
    expect(withoutVersionMarker('Send Sms + Email (1.1.4)')).toBe('Send Sms + Email');
    expect(withoutVersionMarker('Sync Qonto')).toBe('Sync Qonto');
  });

  it('keeps a name made only of a marker', () => {
    expect(withoutVersionMarker('(1.1.4)')).toBe('(1.1.4)');
  });
});

describe('renameWithVersion', () => {
  it('replaces the number in place, in the form already used', () => {
    expect(renameWithVersion('Send Sms + Email (1.1.4)', '1.2.0')).toBe('Send Sms + Email (1.2.0)');
    expect(renameWithVersion('Send Sms + Email v1.1.4', '1.2.0')).toBe('Send Sms + Email v1.2.0');
  });

  it('keeps the env suffix and the archived prefix around it', () => {
    expect(renameWithVersion('Send Sms + Email (1.1.4) - PROD', '1.2.0')).toBe(
      'Send Sms + Email (1.2.0) - PROD',
    );
    expect(renameWithVersion('[ARCHIVED] Send Sms + Email (1.1.4) (prod)', '1.2.0')).toBe(
      '[ARCHIVED] Send Sms + Email (1.2.0) (prod)',
    );
  });

  it('leaves a name without a marker alone : on n’impose pas une notation non choisie', () => {
    expect(renameWithVersion('Sync Qonto', '1.2.0')).toBe('Sync Qonto');
    expect(renameWithVersion('Sync Qonto - PROD', '1.2.0')).toBe('Sync Qonto - PROD');
  });

  it('refuses to write something that is not a semver', () => {
    expect(renameWithVersion('Send Sms + Email (1.1.4)', 'v2')).toBe('Send Sms + Email (1.1.4)');
  });
});
