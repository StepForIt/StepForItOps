import { describe, expect, it } from 'vitest';
import { locateIndex, locateQuote } from '../src/domain/code-location';

const CODE = [
  'const a = 1;',
  'const b = $json.foo;',
  'if (!b) {',
  '  throw new Error("x");',
  '}',
  'return [{ json: { b } }];',
].join('\n');

describe('locateIndex', () => {
  it('donne la ligne 1-indexée et son contexte', () => {
    const at = locateIndex(CODE, CODE.indexOf('$json'));
    expect(at.line).toBe(2);
    expect(at.snippetStart).toBe(1);
    expect(at.snippet).toContain('const a = 1;');
    expect(at.snippet).toContain('throw new Error');
  });
});

describe('locateQuote', () => {
  it('retrouve un fragment recopié tel quel', () => {
    expect(locateQuote(CODE, 'throw new Error("x");')?.line).toBe(4);
  });

  it('retrouve un fragment ré-indenté par l’IA', () => {
    expect(locateQuote(CODE, '   throw   new Error("x");  ')?.line).toBe(4);
  });

  it('renvoie null plutôt qu’un numéro inventé', () => {
    expect(locateQuote(CODE, 'await fetch(url)')).toBeNull();
  });
});
