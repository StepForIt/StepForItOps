import { describe, expect, it } from 'vitest';
import { isNoisyAiFinding, looksLikePlaceholder } from '../src/domain/finding-noise';

describe('looksLikePlaceholder', () => {
  it('reconnaît les gabarits usuels', () => {
    expect(looksLikePlaceholder('{ "product": "[productId]" }')).toBe(true);
    expect(looksLikePlaceholder('url: {{ $json.endpoint }}')).toBe(true);
    expect(looksLikePlaceholder('Bearer <token>')).toBe(true);
    expect(looksLikePlaceholder('host = %HOST%')).toBe(true);
    expect(looksLikePlaceholder('// TODO brancher la vraie base')).toBe(true);
  });

  it('laisse passer une vraie valeur en dur', () => {
    expect(looksLikePlaceholder('const key = "sk-live-9f2c"')).toBe(false);
  });
});

describe('isNoisyAiFinding', () => {
  it('écarte ce que n8n normalise lui-même', () => {
    expect(
      isNoisyAiFinding('Le retour n’est pas au format attendu [{json:{...}}], doit être un tableau d’items'),
    ).toBe(true);
  });

  it('écarte le « codé en dur » qui vise un placeholder', () => {
    expect(isNoisyAiFinding('Le code produit est codé en dur', '{ product: "[productId]" }')).toBe(true);
  });

  it('garde le « codé en dur » sur une vraie valeur', () => {
    expect(isNoisyAiFinding('Le token est codé en dur', 'const t = "sk-live-9f2c"')).toBe(false);
  });

  it('reconnaît les mêmes bruits dans une revue écrite en anglais', () => {
    expect(isNoisyAiFinding('The Code node must return an array of items, not the expected format')).toBe(
      true,
    );
    expect(isNoisyAiFinding('The product code is hard coded', '{ product: "[productId]" }')).toBe(true);
    expect(isNoisyAiFinding('The token is hardcoded', 'const t = "sk-live-9f2c"')).toBe(false);
  });

  it('garde une remarque ordinaire', () => {
    expect(isNoisyAiFinding('Aucune garde sur items[0] : erreur si input vide')).toBe(false);
  });
});
