/**
 * Les profils d'environnement. Un profil = une URL + de quoi ouvrir la session.
 *
 * Tout vient de VARIABLES : `.env` (ignoré par git) ou l'environnement du shell.
 * Jamais d'identifiant dans ce fichier — il est commité, et un mot de passe
 * commité ne s'efface pas d'un historique.
 *
 * Un profil se nomme par son suffixe : `AUDIT_STAGING_URL` crée l'environnement
 * `staging`, joignable par `--env=staging`. Aucune liste à tenir à jour.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Lit un `.env` minimal : `CLÉ=valeur`, `#` en commentaire, pas d'interpolation. */
function readDotEnv(dir) {
  const path = join(dir, '.env');
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return out;
}

export function loadEnvProfile(name, dir) {
  const file = readDotEnv(dir);
  const read = (key) => process.env[key] ?? file[key];
  const prefix = `AUDIT_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

  const baseUrl = read(`${prefix}_URL`) ?? (name === 'local' ? 'http://localhost:3000' : undefined);
  if (!baseUrl)
    throw new Error(
      `Environnement « ${name} » inconnu : pose ${prefix}_URL dans ${join(dir, '.env')} ` +
        `(modèle : .env.example).`,
    );

  return {
    name,
    baseUrl: baseUrl.replace(/\/$/, ''),
    // Repli sur les variables sans préfixe : un seul environnement audité ne
    // mérite pas de les nommer deux fois.
    username: read(`${prefix}_USERNAME`) ?? read('AUDIT_USERNAME'),
    password: read(`${prefix}_PASSWORD`) ?? read('AUDIT_PASSWORD'),
  };
}
