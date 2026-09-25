import { expect, test } from '@playwright/test';
import { login } from './helpers';

/**
 * Le menu sur un téléphone : un seul bouton, en haut à droite, dans la barre du
 * haut. Celui que pose le sider Refine, fixé à gauche par-dessus la page,
 * recouvrait le premier contrôle de chaque écran.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('le menu mobile s’ouvre depuis le coin haut droit sans recouvrir la page', async ({ page }) => {
  await login(page);
  await page.goto('/versions');

  const menu = page.getByRole('button', { name: 'Ouvrir le menu' });
  await expect(menu).toBeVisible({ timeout: 30_000 });
  const box = await menu.boundingBox();
  if (!box) throw new Error('bouton de menu introuvable');
  expect(box.x + box.width).toBeGreaterThan(390 - 24);
  expect(box.y).toBeLessThan(56);

  // L'ancien bouton du sider, fixé à gauche sur la page, n'est plus affiché.
  await expect(page.locator('.app-sider > .ant-btn')).toBeHidden();

  // Le premier contrôle de la page n'est recouvert par rien.
  const search = page.locator('.ant-select, .ant-input-search').first();
  const at = await search.boundingBox();
  if (!at) throw new Error('premier contrôle introuvable');
  const topmost = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('.ant-select, .ant-input-search') !== null,
    [at.x + 8, at.y + at.height / 2],
  );
  expect(topmost).toBe(true);

  await menu.click();
  await expect(page.getByRole('menuitem', { name: /Workflows/ }).first()).toBeVisible();
});
