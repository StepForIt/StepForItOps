import { expect, test } from '@playwright/test';
import { login } from './helpers';

/**
 * L'activation d'un module : le parcours d'ÉCRITURE le plus simple de la
 * console, et celui qui prouve que le chemin retour fonctionne — clic, PATCH à
 * travers le proxy, réponse, rendu. Les lectures peuvent toutes marcher avec un
 * proxy à moitié câblé ; une écriture, non.
 *
 * Un module core ne se désactive pas : son interrupteur est éteint dans l'UI,
 * et l'API refuserait de toute façon. Les deux moitiés de cette règle sont
 * vérifiées ici et dans les tests d'api.
 */
test.describe('les modules', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/modules');
  });

  test('désactive puis réactive un module, la désactivation étant confirmée', async ({ page }) => {
    const row = page.getByRole('row', { name: /Vérification/ }).first();
    const toggle = row.getByRole('switch');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    // Un clic n'éteint plus tout de suite : il ouvre une confirmation qui nomme
    // le module ET ce qui s'arrête. Tant qu'elle n'est pas validée, rien ne bouge.
    await toggle.click();
    await expect(page.getByText(/Désactiver .*Vérification/)).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    await page.getByRole('button', { name: 'Désactiver' }).click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    // Rechargée, la page dit toujours la même chose : le changement est en base,
    // pas seulement dans l'écran.
    await page.reload();
    const reloaded = page
      .getByRole('row', { name: /Vérification/ })
      .first()
      .getByRole('switch');
    await expect(reloaded).toHaveAttribute('aria-checked', 'false');

    // Réactiver est direct — aucune confirmation, on n'arrête rien.
    await reloaded.click();
    await expect(reloaded).toHaveAttribute('aria-checked', 'true');
  });

  test('annuler la confirmation laisse le module actif', async ({ page }) => {
    const row = page.getByRole('row', { name: /Vérification/ }).first();
    const toggle = row.getByRole('switch');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    await toggle.click();
    await page.getByRole('button', { name: 'Annuler' }).click();

    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  test('n’offre pas de désactiver un module core', async ({ page }) => {
    const row = page.getByRole('row', { name: /Workflows/ }).first();

    await expect(row.getByRole('switch')).toBeDisabled();
  });
});
