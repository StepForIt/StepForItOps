/**
 * Signature HMAC-SHA256 de valeurs de cookie.
 *
 * Permet de poser une valeur dans un cookie sans qu'un client puisse la forger :
 * la valeur stockée est `payload.signature`, où la signature ne peut être
 * produite que par le serveur (qui détient le secret). À la relecture on
 * recalcule la signature et on la compare en temps constant ; toute altération
 * du payload invalide le cookie.
 *
 * Web Crypto uniquement (pas de dépendance Node) : compatible runtime Edge
 * (middleware) ET Node (route handlers).
 */

function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesFromB64url(value: string): Uint8Array {
  let t = value.replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(data: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}

/** Comparaison en temps constant : ne fuite pas la position du premier octet différent. */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Signe `value` : retourne `payload.signature` (base64url). */
export async function signValue(value: string, secret: string): Promise<string> {
  const payload = b64urlFromBytes(new TextEncoder().encode(value));
  const signature = b64urlFromBytes(await hmac(payload, secret));
  return `${payload}.${signature}`;
}

/**
 * Vérifie et décode une valeur signée par `signValue`.
 * Retourne la valeur d'origine, ou `null` si la signature est absente/invalide.
 */
export async function verifyValue(token: string, secret: string): Promise<string | null> {
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  try {
    if (!timingSafeEqualBytes(bytesFromB64url(signature), await hmac(payload, secret))) return null;
    return new TextDecoder().decode(bytesFromB64url(payload));
  } catch {
    return null;
  }
}
