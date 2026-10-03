/**
 * Clé d'export, côté console : GÉNÉRÉE à chaque téléchargement, montrée une
 * fois pour être copiée, redemandée à l'import. Elle n'est enregistrée NULLE
 * PART — ni ici, ni par l'API. Générée plutôt que choisie : une phrase humaine
 * n'a pas l'entropie d'une clé, et il n'y a rien à inventer.
 */

/** Sans 0/o, 1/l/i : une clé se recopie parfois à la main. 31 signes, 20 tirés ≈ 99 bits. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function generateExportKey(): string {
  const chars: string[] = [];
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  while (chars.length < 20) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      // Rejet au-delà du dernier multiple : sinon les premiers signes sortiraient plus souvent.
      if (byte < limit && chars.length < 20) chars.push(ALPHABET[byte % ALPHABET.length]);
    }
  }
  return [0, 5, 10, 15].map((at) => chars.slice(at, at + 5).join('')).join('-');
}

/** Un export de config dont les secrets sont scellés porte l'en-tête de la clé. */
export function isSealedBundle(bundle: { sealed?: unknown }): boolean {
  return Boolean(bundle.sealed);
}

const SEALED_MAGIC = 'NWMSEAL1';

/** Une sauvegarde complète scellée commence par sa signature ; une ancienne est un gzip nu. */
export function isSealedBackupHead(head: Uint8Array): boolean {
  return new TextDecoder().decode(head.subarray(0, SEALED_MAGIC.length)) === SEALED_MAGIC;
}
