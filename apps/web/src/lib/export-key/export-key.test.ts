import { describe, expect, it } from 'vitest';
import { generateExportKey, isSealedBackupHead, isSealedBundle } from './export-key';

describe('generateExportKey', () => {
  it('rend une clé longue, lisible et différente à chaque fois', () => {
    const a = generateExportKey();
    expect(a).toMatch(/^[a-z2-9]{5}(-[a-z2-9]{5}){3}$/);
    expect(a).not.toMatch(/[01lio]/);
    expect(generateExportKey()).not.toBe(a);
    // Au-dessus du plancher de l'API (12 caractères).
    expect(a.length).toBeGreaterThanOrEqual(12);
  });
});

describe('fichiers scellés', () => {
  it('reconnaît un export de config dont les secrets sont scellés', () => {
    expect(isSealedBundle({ sealed: { kdf: 'scrypt', salt: 's', check: 'c' } })).toBe(true);
    expect(isSealedBundle({})).toBe(false);
  });

  it('reconnaît une sauvegarde scellée à ses premiers octets, pas un ancien gzip', () => {
    expect(isSealedBackupHead(new TextEncoder().encode('NWMSEAL1xxxx'))).toBe(true);
    expect(isSealedBackupHead(new Uint8Array([0x1f, 0x8b, 0x08, 0]))).toBe(false);
  });
});
