import { Page, expect } from '@playwright/test';

export const CREDENTIALS = { username: 'e2e', password: 'mot-de-passe-e2e' };

/**
 * Ouvre une session par identifiant / mot de passe. Le formulaire poste vers
 * `/auth/password`, qui repose le cookie signé puis redirige : on attend la page
 * d'arrivée, jamais un délai.
 */
export async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[name="username"]', CREDENTIALS.username);
  await page.fill('input[name="password"]', CREDENTIALS.password);
  await page.click('button[type="submit"]');
  await expect(page).not.toHaveURL(/\/login/);
}

/**
 * Bascule la liste en « un par workflow n8n ».
 *
 * La page s'ouvre en vue GROUPÉE — la question courante compare les envs d'un
 * même workflow métier —, et c'est la vue plate qui montre les exemplaires un à
 * un, leur nom en lien vers leur page.
 */
export async function showOnePerWorkflow(page: Page): Promise<void> {
  // Trois choses se liguent contre ce simple changement de vue.
  //
  // Le `Segmented` d'antd fait glisser une pastille par-dessus ses libellés :
  // un clic, même `force`, part à des COORDONNÉES que le navigateur remet à la
  // pastille, qui n'écoute rien. D'où l'événement posé sur l'input radio
  // lui-même, que React écoute — pas de coordonnées, rien à intercepter.
  //
  // Encore faut-il que React ÉCOUTE : tant que la page n'est pas hydratée,
  // l'événement part dans le vide. On attend donc que la liste ait rendu ses
  // données — elles viennent d'un fetch côté client, qui n'a lieu qu'une fois
  // React branché.
  await expect(page.getByRole('row', { name: /Facturation/ }).first()).toBeVisible();

  // Et l'on réessaie, borné : l'hydratation n'a pas d'événement public qu'on
  // puisse attendre, et une passe de rendu peut encore remplacer le nœud entre
  // la vérification ci-dessus et l'événement. Ce qu'on attend est la BASCULE
  // — la colonne qui n'existe que dans la vue plate —, jamais le clic.
  await expect(async () => {
    await page.getByRole('radio', { name: 'Un par workflow n8n' }).dispatchEvent('click');
    await expect(page.getByRole('columnheader', { name: 'Nom' })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

/**
 * Ouvre une route et attend qu'elle soit RENDUE, en réessayant la navigation.
 *
 * `next dev` compile chaque route à sa première visite : sur un runner partagé,
 * cette compilation dépasse parfois le budget d'une navigation, et le serveur
 * coupe la connexion en cours de route (`ERR_CONNECTION_RESET`). Le deuxième
 * essai retombe sur une route déjà compilée. Ce qu'on attend reste précis — la
 * barre du haut, donc une page montée —, seul le nombre d'essais tient compte
 * de l'hôte.
 */
export async function gotoCompiled(page: Page, route: string): Promise<void> {
  await expect(async () => {
    await page.goto(route, { timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Ouvrir le menu' })).toBeVisible({ timeout: 30_000 });
  }).toPass({ timeout: 180_000, intervals: [1_000] });
}
