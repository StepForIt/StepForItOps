import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, stat, unlink } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ExportKey, ExportKeyError, deriveExportKey } from './export-key';

/**
 * Un fichier ENTIER scellé par la clé d'export, en flux : la sauvegarde
 * complète pèse des centaines de Mo et ne tient pas en mémoire. Elle porte des
 * secrets dans des colonnes qu'aucune liste ne tient à jour (une table ajoutée
 * demain part d'elle-même), d'où le fichier entier plutôt que des champs.
 *
 * Format : `NWMSEAL1` · sel (16) · IV (12) · chiffré · tag GCM (16). Le tag vient
 * à la FIN parce qu'on ne le connaît qu'après le dernier octet ; à la relecture
 * il est lu d'abord, si bien qu'une clé fausse ou un octet altéré échouent au
 * bout du déchiffrement, et le fichier produit est alors effacé.
 */

const MAGIC = Buffer.from('NWMSEAL1');
const SALT = 16;
const IV = 12;
const TAG = 16;
const HEADER = MAGIC.length + SALT + IV;

export function sealingStream(passphrase: string | undefined): Transform {
  // Valide la phrase (absente, trop courte) avant d'écrire le moindre octet.
  ExportKey.assertUsable(passphrase);
  const salt = randomBytes(SALT);
  const iv = randomBytes(IV);
  const cipher = createCipheriv('aes-256-gcm', deriveExportKey(passphrase, salt), iv);
  let started = false;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      if (!started) {
        this.push(Buffer.concat([MAGIC, salt, iv]));
        started = true;
      }
      done(null, cipher.update(chunk));
    },
    flush(done) {
      if (!started) this.push(Buffer.concat([MAGIC, salt, iv]));
      this.push(cipher.final());
      done(null, cipher.getAuthTag());
    },
  });
}

export async function isSealedFile(path: string): Promise<boolean> {
  const handle = await open(path, 'r');
  try {
    const head = Buffer.alloc(MAGIC.length);
    const { bytesRead } = await handle.read(head, 0, MAGIC.length, 0);
    return bytesRead === MAGIC.length && head.equals(MAGIC);
  } finally {
    await handle.close();
  }
}

export async function unsealFile(
  path: string,
  passphrase: string | undefined,
  outPath: string,
): Promise<void> {
  if (!passphrase) throw new ExportKeyError('missing');
  const { size } = await stat(path);
  if (size < HEADER + TAG) throw new ExportKeyError('wrong');
  const handle = await open(path, 'r');
  const head = Buffer.alloc(HEADER);
  const tag = Buffer.alloc(TAG);
  try {
    await handle.read(head, 0, HEADER, 0);
    await handle.read(tag, 0, TAG, size - TAG);
  } finally {
    await handle.close();
  }
  const salt = head.subarray(MAGIC.length, MAGIC.length + SALT);
  const iv = head.subarray(MAGIC.length + SALT);
  const decipher = createDecipheriv('aes-256-gcm', deriveExportKey(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      createReadStream(path, { start: HEADER, end: size - TAG - 1 }),
      decipher,
      createWriteStream(outPath),
    );
  } catch {
    await unlink(outPath).catch(() => undefined);
    throw new ExportKeyError('wrong');
  }
}
