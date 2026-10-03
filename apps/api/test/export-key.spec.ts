import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { describe, expect, it } from 'vitest';
import { ExportKey, ExportKeyError } from '../src/infra/secrets/export-key';
import { isSealedFile, sealingStream, unsealFile } from '../src/infra/secrets/export-file-cipher';

/**
 * La clé d'export : donnée à l'export, redemandée à l'import. Un fichier
 * exporté ne vaut rien sans elle, et il n'emporte JAMAIS la clé de la base
 * (`SECRETS_KEY`) : perdre ce fichier et sa clé n'ouvre que ce fichier-là.
 */

const PASSPHRASE = 'cheval-agrafe-batterie';

describe('ExportKey — secrets scellés champ par champ', () => {
  it('scelle puis rouvre avec la même clé, sans rien laisser en clair', () => {
    const key = ExportKey.create(PASSPHRASE);
    const sealed = key.seal('n8n_api_secret');

    expect(ExportKey.isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain('n8n_api_secret');
    expect(ExportKey.open(key.header(), PASSPHRASE).unseal(sealed)).toBe('n8n_api_secret');
  });

  it('refuse une autre clé dès l’ouverture, avant de toucher à un secret', () => {
    const header = ExportKey.create(PASSPHRASE).header();
    expect(() => ExportKey.open(header, 'une-autre-cle-longue')).toThrow(ExportKeyError);
  });

  it('refuse une clé trop courte ou absente', () => {
    expect(() => ExportKey.create('court')).toThrow(expect.objectContaining({ reason: 'too-short' }));
    const header = ExportKey.create(PASSPHRASE).header();
    expect(() => ExportKey.open(header, undefined)).toThrow(expect.objectContaining({ reason: 'missing' }));
  });

  it('laisse passer une valeur qui n’était pas scellée (ancien fichier)', () => {
    expect(ExportKey.create(PASSPHRASE).unseal('valeur-ancienne')).toBe('valeur-ancienne');
  });
});

describe('fichier entier scellé (sauvegarde complète)', () => {
  async function sealToFile(content: Buffer, passphrase: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'nwm-seal-'));
    const path = join(dir, 'sealed.bin');
    const out = new PassThrough();
    const chunks: Buffer[] = [];
    out.on('data', (c: Buffer) => chunks.push(c));
    await pipeline(
      Readable.from([content.subarray(0, 5), content.subarray(5)]),
      sealingStream(passphrase),
      out,
    );
    await writeFile(path, Buffer.concat(chunks));
    return path;
  }

  it('rend le contenu d’origine avec la bonne clé', async () => {
    const content = Buffer.from('ligne 1\nsecret-key\nligne 3\n');
    const path = await sealToFile(content, PASSPHRASE);

    expect(await isSealedFile(path)).toBe(true);
    expect((await readFile(path)).includes(Buffer.from('secret-key'))).toBe(false);

    const out = `${path}.plain`;
    await unsealFile(path, PASSPHRASE, out);
    expect(await readFile(out)).toEqual(content);
  });

  it('refuse une autre clé ou un fichier altéré, sans rien produire de lisible', async () => {
    const path = await sealToFile(Buffer.from('contenu'), PASSPHRASE);
    await expect(unsealFile(path, 'une-autre-cle-longue', `${path}.a`)).rejects.toBeInstanceOf(
      ExportKeyError,
    );

    const bytes = await readFile(path);
    bytes[bytes.length - 20] ^= 0xff;
    await writeFile(path, bytes);
    await expect(unsealFile(path, PASSPHRASE, `${path}.b`)).rejects.toBeInstanceOf(ExportKeyError);
  });

  it('reconnaît un ancien fichier non scellé', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nwm-seal-'));
    const path = join(dir, 'plain.gz');
    await writeFile(path, Buffer.from([0x1f, 0x8b, 0x08, 0x00]));
    expect(await isSealedFile(path)).toBe(false);
  });
});
