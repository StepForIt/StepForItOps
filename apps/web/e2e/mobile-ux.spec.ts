import { expect, test } from '@playwright/test';
import { login } from './helpers';

/**
 * Le mobile n'est pas un cas de bord ici : la console s'installe en PWA, et la
 * page `/app-logs` existe pour lire les logs DEPUIS un téléphone. Ce parcours
 * tient la règle mesurée par l'audit UX (NOPS-34) à 390 px — la largeur d'un
 * téléphone courant — que ni les tests d'api ni les composants ne voient : un
 * `<Table>` sans `scroll.x` fait déborder la PAGE entière en latéral au lieu du
 * seul tableau, et une cible tactile sous 44 px se rate au doigt.
 *
 * La preuve se fait sur la base SEEDÉE (`seed-e2e.mjs`), donc peuplée : un
 * tableau vide n'a aucune ligne à faire déborder, ce qui est exactement pourquoi
 * l'audit local (base vide) n'avait rien pu confirmer.
 */
const PHONE = { width: 390, height: 844 };

test.use({ viewport: PHONE });

/** La page ne défile pas en latéral : tout tient dans la largeur du téléphone. */
async function expectNoHorizontalPageScroll(page: import('@playwright/test').Page): Promise<void> {
  // +1 px : les navigateurs arrondissent les sous-pixels, et un tableau qui tient
  // pile peut afficher 391 pour 390.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'la page déborde en latéral à 390 px').toBeLessThanOrEqual(1);
}

test.describe('la console à 390 px', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('la liste des workflows ne fait pas déborder la page', async ({ page }) => {
    await page.goto('/workflows');
    // On attend une donnée du seed avant de mesurer : une liste encore vide ne
    // déborde jamais, et mesurer trop tôt rendrait le test faussement vert.
    await expect(page.getByText(/Facturation/).first()).toBeVisible({ timeout: 30_000 });

    // Sous 768 px, la page Workflows rend ses lignes en cartes dépliables
    // (`app/workflows/mobile/`) plutôt qu'en `<Table>` : rien à faire défiler de
    // côté, la largeur tient dans l'écran. C'est ce que l'audit ne pouvait pas
    // mesurer sur une base vide (aucune ligne à faire déborder).
    await expectNoHorizontalPageScroll(page);
  });

  test('la liste des clients ne fait pas déborder la page', async ({ page }) => {
    await page.goto('/clients');
    await expect(page.getByRole('cell').first()).toBeVisible({ timeout: 30_000 });

    await expectNoHorizontalPageScroll(page);
  });

  test('les interrupteurs de la page Modules ont une cible tactile de 44 px', async ({ page }) => {
    await page.goto('/modules');
    // Sous 768 px, la table des modules se replie elle aussi en lignes dépliables
    // (`ResizableTable` → `MobileTable`) : l'interrupteur d'un module vit dans le
    // détail de sa ligne, atteint en la dépliant. On vise une ligne de MODULE par
    // son nom : la page porte d'AUTRES lignes dépliables (le catalogue de nœuds
    // « Par instance » est aussi une `MobileTable`), et cibler « la première ligne
    // repliée » dépliait celle-là au lieu d'un module.
    const row = page.getByRole('button', { name: 'Monitoring', exact: true });
    await expect(row).toBeVisible({ timeout: 30_000 });

    // La page Modules est la plus dense (trois cartes de réglages + tableau) : rien
    // n'y déborde de côté, tout tient dans la largeur du téléphone.
    await expectNoHorizontalPageScroll(page);

    // Dépliée, la ligne montre son interrupteur : sa zone tapable doit faire 44 px
    // de haut (l'interrupteur antd n'en fait que 22, sous le minimum au doigt).
    await row.click();
    const toggle = page.getByTestId('module-toggle').first();
    await expect(toggle).toBeVisible();
    const box = await toggle.boundingBox();
    expect(box, 'cible tactile sans boîte mesurable').not.toBeNull();
    expect(box!.height, 'cible tactile sous 44 px').toBeGreaterThanOrEqual(44);
  });
});
