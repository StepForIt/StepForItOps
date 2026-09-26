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

  // Appui long : mode sélection, barre des gestes d'environnement. Rejoué tant qu'il n'a pas pris :
  // sur un runner chargé, le relâché peut passer avant le minuteur de l'appui long et compter
  // pour un tap (la ligne se replie). Un appui long cassé échoue quand même, au bout du délai.
  const selected = page.getByText('1 workflow métier sélectionné');
  await expect(async () => {
    // Le premier bouton « Facturation » est l'en-tête du workflow métier, ses exemplaires suivent.
    const box = await page
      .getByRole('button', { name: /Facturation/ })
      .first()
      .boundingBox();
    if (!box) throw new Error('ligne introuvable');
    await page.mouse.move(box.x + 40, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up();
    await expect(selected).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
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
