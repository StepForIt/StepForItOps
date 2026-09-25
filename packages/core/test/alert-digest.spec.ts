import { describe, expect, it } from 'vitest';
import { AlertDigestBuffer } from '../src/domain/alert-digest';

const WINDOW = 10 * 60 * 1000;
const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 9, minutes));

describe('AlertDigestBuffer', () => {
  it('ignore une clé jamais annoncée', () => {
    const buffer = new AlertDigestBuffer<string>(WINDOW);
    expect(buffer.add('g1')).toBe(false);
    expect(buffer.size).toBe(0);
  });

  it("ne rend rien tant que la fenêtre n'est pas écoulée", () => {
    const buffer = new AlertDigestBuffer<string>(WINDOW);
    buffer.arm('g1', 'pb', at(40));
    buffer.add('g1');
    buffer.add('g1');
    expect(buffer.due(at(45))).toEqual([]);
  });

  it('rend un récapitulatif par fenêtre, daté du dernier message', () => {
    const buffer = new AlertDigestBuffer<string>(WINDOW);
    buffer.arm('g1', 'pb', at(40));
    for (let i = 0; i < 5; i++) buffer.add('g1');

    const [digest] = buffer.due(at(51));
    expect(digest.count).toBe(5);
    expect(digest.since).toEqual(at(40));

    // Fenêtre suivante : le compteur repart de zéro.
    buffer.add('g1');
    const [next] = buffer.due(at(62));
    expect(next.count).toBe(1);
    expect(next.since).toEqual(at(51));
  });

  it('oublie un problème qui se tait', () => {
    const buffer = new AlertDigestBuffer<string>(WINDOW);
    buffer.arm('g1', 'pb', at(40));
    expect(buffer.due(at(51))).toEqual([]);
    expect(buffer.size).toBe(0);
    expect(buffer.add('g1')).toBe(false);
  });

  it('garde la dernière charge utile vue', () => {
    const buffer = new AlertDigestBuffer<string>(WINDOW);
    buffer.arm('g1', 'pb', at(40));
    buffer.add('g1', () => 'pb affiné');
    expect(buffer.due(at(51))[0].payload).toBe('pb affiné');
  });
});
