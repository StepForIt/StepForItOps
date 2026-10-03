import { expect, test } from '@playwright/test';
import { login } from './helpers';

/**
 * L'accès complet à une instance, de bout en bout : la modale à la sauvegarde,
 * le refus écrit SUR l'instance (il tient au rechargement, donc à la
 * reconnexion), sa levée depuis la fiche, puis le compte renseigné depuis le
 * bandeau. La règle elle-même est tenue par `full-access-prompt.test.ts` ; ce
 * parcours tient l'assemblage — formulaire Refine, proxy, en-tête d'auteur,
 * fiche — qu'aucun test d'un seul côté ne voit.
 *
 * Chaque parcours crée SA propre instance, sous un nom unique : la base n'est
 * pas vidée entre deux rejeux, et un nom partagé ferait deux lignes au second.
 */
const uniqueName = (prefix: string) => `${prefix} ${Date.now().toString(36)}`;

test.describe("l'accès complet à une instance", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('demande une fois, retient le refus, le lève, puis enregistre le compte', async ({ page }) => {
    const name = uniqueName('Bureau');
    await page.goto('/instances/create');
    await page.getByLabel('Nom').fill(name);
    await page.getByLabel('URL de base').fill('http://127.0.0.1:3912');
    await page.getByLabel('Clé API').fill('e2e-bureau');

    // Sans compte propriétaire : la modale, et pas encore la sauvegarde.
    await page.getByRole('button', { name: /^(save )?Enregistrer$/ }).click();
    const modal = page.getByRole('dialog', { name: /Accès complet à cette instance/ });
    await expect(modal).toBeVisible();

    // « Continuer sans » + la case : la saisie part entière, le refus avec elle.
    await modal.getByRole('checkbox', { name: /Ne plus me demander/ }).check();
    await modal.getByRole('button', { name: 'Continuer sans' }).click();
    await expect(page).toHaveURL(/\/instances$/);
    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await expect(row.getByText('accès partiel')).toHaveCount(0);

    // Le refus est en base, daté et signé : la fiche le dit, rechargée aussi.
    await row.getByRole('link', { name }).click();
    await expect(page.getByText(/Accès complet refusé le .* par e2e/)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/Accès complet refusé le/)).toBeVisible();

    // Levé depuis la fiche : le bandeau revient.
    await page.getByRole('button', { name: "Redemander l'accès complet" }).click();
    const banner = page.locator('.ant-alert', { hasText: 'Accès partiel' });
    await expect(banner).toBeVisible();

    // « Renseigner » ouvre la même modale ; le compte enregistré éteint le bandeau.
    await banner.getByRole('button', { name: 'Renseigner' }).click();
    const again = page.getByRole('dialog', { name: /Accès complet à cette instance/ });
    await again.getByLabel('E-mail du propriétaire n8n').fill('owner@bureau.test');
    await again.getByLabel('Mot de passe').fill('secret-e2e');
    await again.getByRole('button', { name: "Enregistrer avec l'accès complet" }).click();
    await expect(banner).toHaveCount(0);
    await expect(page.getByText(/Accès complet refusé le/)).toHaveCount(0);
  });

  test('une instance qui a déjà son compte ne déclenche rien', async ({ page }) => {
    // Créée avec son compte par l'api, à travers le proxy de la console et la session ouverte.
    const response = await page.request.post('/backend/instances', {
      data: {
        name: uniqueName('Siège'),
        baseUrl: 'http://127.0.0.1:3912',
        apiKey: 'e2e-siege',
        n8nEmail: 'owner@siege.test',
        n8nPassword: 'secret-e2e',
      },
    });
    expect(response.ok()).toBe(true);
    const { id } = (await response.json()) as { id: string };

    await page.goto(`/instances/edit/${id}`);
    await expect(page.getByLabel('Nom')).toHaveValue(/Siège/);
    await page.getByRole('button', { name: /^(save )?Enregistrer$/ }).click();
    await expect(page).toHaveURL(/\/instances$/);
    await expect(page.getByRole('dialog', { name: /Accès complet/ })).toHaveCount(0);
  });
});
