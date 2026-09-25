import { Page, expect, test } from '@playwright/test';
import { login } from './helpers';

/**
 * La liste des workflows sur un téléphone : lignes repliées, dépliage au tap,
 * sélection à l'appui long, filtres dans un tiroir. Un seul parcours, parce que
 * c'est l'assemblage qui casse — breakpoint, gestes et barre d'actions — et
 * qu'aucun test unitaire ne le voit : la logique des gestes, elle, est tenue par
 * `mobile-gestures.test.ts`.
 */
test.use({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true });

/** La ligne repliée d'un workflow métier : son en-tête, bouton du dépliage. */
const familyRow = (page: Page, name: RegExp) => page.getByRole('button', { name, expanded: false }).first();

test('la liste des workflows tient sur un téléphone', async ({ page }) => {
  await login(page);
  await page.goto('/workflows');

  // Liste compacte : pas de tableau, pas de défilement horizontal.
  const facturation = familyRow(page, /Facturation/);
  await expect(facturation).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('columnheader')).toHaveCount(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // Tap : la ligne se déplie sur ses exemplaires.
  await facturation.click();
  await expect(page.getByRole('button', { name: /Facturation/, expanded: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Facturation - DEV/ })).toBeVisible();

  // Appui long : mode sélection, barre des gestes d'environnement.
  const header = page.getByRole('button', { name: /Facturation/, expanded: true });
  const box = await header.boundingBox();
  if (!box) throw new Error('ligne introuvable');
  await page.mouse.move(box.x + 40, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
  await expect(page.getByText('1 workflow métier sélectionné')).toBeVisible();
  await page.getByRole('button', { name: 'Tout décocher' }).click();
  await expect(page.getByText('1 workflow métier sélectionné')).toHaveCount(0);

  // Filtres : dans un tiroir, le badge compte ceux posés.
  await page.getByRole('button', { name: /Filtres/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Filtres' });
  await expect(drawer).toBeVisible();
  await drawer.locator('.ant-select', { hasText: 'Statut' }).click();
  await page.getByTitle('actifs', { exact: true }).click();
  await drawer.getByRole('button', { name: 'Appliquer' }).click();
  await expect(page.locator('.ant-badge-count')).toHaveText('1');
});
