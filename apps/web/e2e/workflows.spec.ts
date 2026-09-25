import { expect, test } from '@playwright/test';
import { login, showOnePerWorkflow } from './helpers';

/**
 * La liste des workflows : le parcours que tout le monde fait dix fois par jour,
 * et le seul qui traverse d'un bout à l'autre le proxy `/backend/*`, le
 * dataProvider Refine (fenêtre + `x-total-count`) et le filtre des archivés.
 * Chacun des trois est tenu de son côté ; c'est leur assemblage qui ne l'était
 * pas.
 */
test.describe('les workflows', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/workflows');
  });

  test('affiche les exemplaires vivants et tait les archivés', async ({ page }) => {
    await showOnePerWorkflow(page);

    await expect(page.getByRole('cell', { name: 'Facturation - DEV' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Facturation - PROD' })).toBeVisible();
    await expect(page.getByRole('cell', { name: /Relances clients/ })).toBeVisible();

    // Rangé : présent en base, absent de la liste tant que le réglage ne le dit pas.
    await expect(page.getByRole('cell', { name: 'Vieux truc' })).toHaveCount(0);
  });

  test('filtre par la recherche', async ({ page }) => {
    await showOnePerWorkflow(page);
    await page.getByPlaceholder('Rechercher par nom').fill('Relances');

    await expect(page.getByRole('cell', { name: /Relances clients/ })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Facturation - DEV' })).toHaveCount(0);
  });

  test('réunit par défaut les exemplaires d’un même workflow métier', async ({ page }) => {
    // La table est rendue AVANT ses données : compter ses lignes trop tôt, c'est
    // compter zéro, et un compteur à zéro ressemble à un regroupement fautif. On
    // attend donc qu'elle porte une ligne qu'on sait unique dans cette vue, avec
    // de quoi couvrir un runner lent, avant de compter celles qui nous
    // intéressent.
    await expect(page.getByRole('row', { name: /Relances clients/ })).toHaveCount(1, {
      timeout: 30_000,
    });

    // « Facturation - DEV » et « Facturation - PROD » ne font qu'une ligne,
    // dépliable sur ses environnements.
    const family = page.getByRole('row', { name: /Facturation/ });
    await expect(family).toHaveCount(1);
    await expect(family).toContainText('dev');
    await expect(family).toContainText('prod');

    await family.getByRole('button', { name: 'Expand row' }).click();

    // `.first()` : la ligne dépliée porte le nom dans sa cellule et dans son
    // libellé accessible, deux nœuds pour un même texte.
    await expect(page.getByRole('cell', { name: 'Facturation - DEV' }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Facturation - PROD' }).first()).toBeVisible();
  });

  test('ouvre la page d’un workflow', async ({ page }) => {
    // La page d'un workflow est la plus lourde de la console (schéma, inventaire
    // des nœuds), et `next dev` la COMPILE à sa première visite : sur un runner,
    // cette compilation seule dépasse le budget ordinaire d'un parcours.
    test.setTimeout(150_000);
    await showOnePerWorkflow(page);
    // Refine repousse les paramètres de la liste dans l'URL après le rendu, et un
    // clic lancé pendant ce remplacement part dans un nœud déjà remonté. C'est
    // donc CE remplacement qu'on attend — surtout pas `networkidle`, que le
    // websocket de rechargement à chaud de `next dev` empêche d'arriver.
    await expect(page).toHaveURL(/view=flat/);

    await page.getByRole('link', { name: 'Relances clients' }).click();

    await page.waitForURL(/\/workflows\/(show|view)\//, { timeout: 120_000 });
    // Le nom n'est pas un titre sur cette page : il ouvre une ligne d'état
    // (nom · instance · actif/inactif), au-dessus du schéma et de l'inventaire.
    await expect(page.getByText('Relances clients').first()).toBeVisible();
    await expect(page.getByText('Atelier').first()).toBeVisible();
  });

  test('range les actions secondaires du workflow sous « ⋯ »', async ({ page }) => {
    await showOnePerWorkflow(page);
    await page.getByRole('link', { name: 'Facturation - DEV' }).first().click();

    // Deux actions sous la main, le rechargement en icône au coin de la fiche.
    await expect(page.getByRole('button', { name: 'Vérifier', exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole('button', { name: 'Recharger depuis n8n' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Environnements' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Autres actions' }).click();
    // Le menu de la page, pas celui du sider : « Environnements » existe des deux côtés.
    const menu = page.locator('.ant-dropdown');
    await expect(menu.getByRole('menuitem', { name: 'Environnements' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /Contrôles/ })).toBeVisible();
    // La doc se lit dans son onglet : plus de « Générer doc » ni de « Voir doc » ici.
    await expect(menu.getByRole('menuitem', { name: /doc/i })).toHaveCount(0);
  });

  test('montre le schéma et la doc dans la fiche, sans changer de page', async ({ page }) => {
    await showOnePerWorkflow(page);
    await page.getByRole('link', { name: 'Facturation - DEV' }).first().click();
    const fiche = new RegExp('/workflows/show/');
    await expect(page).toHaveURL(fiche);

    await expect(page.getByRole('tab', { name: 'Schéma' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('tab', { name: 'Documentation' }).click();
    await expect(page.getByRole('button', { name: /Générer la documentation/ })).toBeVisible();
    await expect(page).toHaveURL(fiche);
  });
});
