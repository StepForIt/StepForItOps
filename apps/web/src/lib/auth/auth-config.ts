/**
 * Lecture de la configuration d'authentification (variables d'environnement).
 *
 * Deux méthodes de connexion, activables indépendamment :
 * - Google OAuth (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET), restreint aux
 *   domaines de GOOGLE_ALLOWED_DOMAIN ;
 * - identifiant / mot de passe d'équipe (APP_PASSWORD), utile en local ou tant
 *   que le client OAuth n'est pas provisionné.
 *
 * Aucune des deux configurée → plateforme ouverte (comportement historique,
 * pratique en dev). Dès que l'une est posée, tout est protégé.
 */

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function isPasswordConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

export function isAuthEnabled(): boolean {
  return isGoogleConfigured() || isPasswordConfigured();
}

/**
 * Domaines Google autorisés (CSV). Aucun défaut : sans `GOOGLE_ALLOWED_DOMAIN`,
 * la connexion Google refuse tout le monde (fail closed) — chaque déploiement
 * doit nommer explicitement son ou ses domaines Workspace.
 */
export function allowedDomains(): string[] {
  const raw = process.env.GOOGLE_ALLOWED_DOMAIN || '';
  return raw
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

export function appUsername(): string {
  return process.env.APP_USERNAME || 'admin';
}

/**
 * Secret de signature des cookies. `SESSION_SECRET` en priorité (recommandé :
 * `openssl rand -hex 32`), sinon un secret déjà présent — le secret OAuth
 * d'abord (haute entropie), le mot de passe d'équipe en dernier recours : un
 * mot de passe court rendrait les sessions forgeables hors-ligne, la console
 * l'affiche en avertissement (SecurityWarnings). Changer ce secret invalide
 * toutes les sessions.
 */
export function sessionSecret(): string {
  return process.env.SESSION_SECRET || process.env.GOOGLE_CLIENT_SECRET || process.env.APP_PASSWORD || '';
}
