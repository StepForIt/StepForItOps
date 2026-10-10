import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { assertValidMapping } from '../src/modules/env-switcher/resource-mapping-input';

const valid = {
  provider: 'airtable',
  logicalName: 'CRM',
  values: { dev: { base: 'appDev' }, prod: { base: 'appProd' } },
  labels: { dev: { base: 'CRM (dev)' } },
};

describe('assertValidMapping', () => {
  it('accepts what the console sends', () => {
    expect(() => assertValidMapping(valid, false)).not.toThrow();
  });

  it('refuses an unknown provider, a blank name and an empty mapping', () => {
    expect(() => assertValidMapping({ ...valid, provider: 'excel' }, false)).toThrow(BadRequestException);
    expect(() => assertValidMapping({ ...valid, logicalName: '  ' }, false)).toThrow(BadRequestException);
    expect(() => assertValidMapping({ ...valid, values: { dev: { base: ' ' } } }, false)).toThrow(
      BadRequestException,
    );
  });

  it('refuses nested ids and non text labels', () => {
    expect(() => assertValidMapping({ ...valid, values: { dev: { base: { id: 1 } } } }, false)).toThrow(
      BadRequestException,
    );
    expect(() => assertValidMapping({ ...valid, labels: { dev: { base: 3 } } }, false)).toThrow(
      BadRequestException,
    );
  });

  it('judges only the fields present on a partial update', () => {
    expect(() => assertValidMapping({ logicalName: 'CRM 2' }, true)).not.toThrow();
    expect(() => assertValidMapping({ provider: 'excel' }, true)).toThrow(BadRequestException);
    expect(() => assertValidMapping({}, false)).toThrow(BadRequestException);
  });
});
