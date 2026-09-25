import { describe, expect, it } from 'vitest';
import { applyDeepReplace, previewDeepReplace } from '../src/domain/json-replace';

describe('json-replace', () => {
  const doc = {
    parameters: { base: 'appPROD123', table: 'tblPROD456', url: 'https://x.tld/appPROD123' },
  };
  const replacements = [
    { from: 'appPROD123', to: 'appDEV999' },
    { from: 'tblPROD456', to: 'tblDEV111' },
  ];

  it('previews hits with paths', () => {
    const hits = previewDeepReplace(doc, replacements);
    expect(hits).toHaveLength(3);
    expect(hits[0]).toEqual({ path: '$.parameters.base', from: 'appPROD123', to: 'appDEV999' });
  });

  it('applies replacements immutably', () => {
    const result = applyDeepReplace(doc, replacements);
    expect(result.parameters.base).toBe('appDEV999');
    expect(result.parameters.url).toBe('https://x.tld/appDEV999');
    expect(doc.parameters.base).toBe('appPROD123');
  });
});
