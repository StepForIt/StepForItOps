import { describe, expect, it } from 'vitest';
import {
  extractNodeRefs,
  extractNodeRefsFromString,
  renameNodeRefsInString,
} from '../src/domain/n8n/expression-refs';

describe('expression-refs', () => {
  it('extracts all reference styles', () => {
    const value = `={{ $node["Get Data"].json.x + $('Format').item.json.y + $items("Loop")[0] }}`;
    expect(extractNodeRefsFromString(value).sort()).toEqual(['Format', 'Get Data', 'Loop']);
  });

  it('walks nested objects with paths', () => {
    const refs = extractNodeRefs({ a: { b: [`={{ $node["X"].json }}`] } });
    expect(refs).toEqual([{ path: '$.a.b[0]', ref: 'X' }]);
  });

  it('renames refs safely (regex-escaped names)', () => {
    const value = `={{ $node["HTTP (v2)"].json }} {{ $('HTTP (v2)').item }}`;
    const renamed = renameNodeRefsInString(value, 'HTTP (v2)', 'Fetch Orders');
    expect(renamed).toBe(`={{ $node["Fetch Orders"].json }} {{ $('Fetch Orders').item }}`);
  });
});
