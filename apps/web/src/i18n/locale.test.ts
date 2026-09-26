import { describe, expect, it } from 'vitest';
import { resolveLocale } from './locale';

describe('resolveLocale', () => {
  it('le cookie prime sur le navigateur', () => {
    expect(resolveLocale('en', 'fr-FR,fr;q=0.9')).toBe('en');
  });
  it('un cookie inconnu est ignoré', () => {
    expect(resolveLocale('de', 'en-US')).toBe('en');
  });
  it('suit les poids du navigateur', () => {
    expect(resolveLocale(undefined, 'de-DE,en;q=0.5,fr;q=0.8')).toBe('fr');
  });
  it('retombe sur le français', () => {
    expect(resolveLocale(undefined, 'de-DE,it;q=0.8')).toBe('fr');
    expect(resolveLocale(undefined, null)).toBe('fr');
  });
});
