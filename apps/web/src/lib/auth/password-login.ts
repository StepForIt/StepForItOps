/**
 * Connexion par identifiant / mot de passe d'équipe (variables d'environnement).
 *
 * Repli sur Google OAuth : dépannage en local, ou tant que le client OAuth
 * n'est pas provisionné. Un seul compte, pas de stockage : la vérité est dans
 * APP_USERNAME / APP_PASSWORD.
 */

import { timingSafeEqualBytes } from './cookie-signing';
import { appUsername, isPasswordConfigured } from './auth-config';

function equals(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  return timingSafeEqualBytes(encoder.encode(a), encoder.encode(b));
}

/** Vérifie les identifiants saisis. Faux si aucun mot de passe n'est configuré. */
export function checkCredentials(username: string, password: string): boolean {
  if (!isPasswordConfigured()) return false;
  // Les deux comparaisons sont évaluées : pas de court-circuit qui distinguerait
  // « mauvais utilisateur » de « mauvais mot de passe » par le temps de réponse.
  const userOk = equals(username.trim(), appUsername());
  const passwordOk = equals(password, process.env.APP_PASSWORD!);
  return userOk && passwordOk;
}
