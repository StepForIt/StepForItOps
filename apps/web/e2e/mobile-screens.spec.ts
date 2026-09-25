import { expect, test } from '@playwright/test';
import { gotoCompiled, login } from './helpers';

/**
 * Les écrans retouchés pour le téléphone au-delà du rendu générique des listes :
 * boutons d'en-tête regroupés sous « ⋯ », filtres dans un tiroir.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('Monitoring range ses actions secondaires sous « ⋯ »', async ({ page }) => {
  await gotoCompiled(page, '/monitors');
  const more = page.getByRole('button', { name: 'Autres actions' });
  await expect(more).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /Importer depuis Kuma/ })).toHaveCount(0);

  await more.click();
  await expect(page.getByRole('menuitem', { name: /Réglages Kuma/ })).toBeVisible();
});

test('Couverture passe ses filtres dans un tiroir et garde la recherche visible', async ({ page }) => {
  await gotoCompiled(page, '/findings');
  await expect(page.getByPlaceholder('Rechercher un workflow…')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: /Filtres/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Filtres' });
  await expect(drawer.getByText('Uniquement avec findings')).toBeVisible();
  await drawer.getByRole('switch').click();
  await drawer.getByRole('button', { name: 'Appliquer' }).click();
  await expect(page.locator('.ant-badge-count')).toHaveText('1');
});

/**
 * Les écrans de réglages et la page d'un workflow : ni tableau à sept champs
 * éditables, ni barre d'outils, ni filtre large ne doivent pousser la page
 * hors de l'écran. On mesure le débordement plutôt qu'un pixel d'affichage.
 */
test('les écrans de réglages et la page d’un workflow tiennent dans l’écran', async ({ page }) => {
  // Trois routes neuves à compiler, une à une, sur un runner partagé.
  test.setTimeout(300_000);
  for (const route of ['/modules', '/app-logs', '/resources']) {
    await gotoCompiled(page, route);
    await page.waitForTimeout(1_000);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `débordement horizontal sur ${route}`).toBeLessThanOrEqual(0);
  }

  // Les logs rangent leurs actions sous « ⋯ », le suivi restant à portée de pouce.
  await gotoCompiled(page, '/app-logs');
  await page.getByRole('button', { name: 'Autres actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Télécharger' })).toBeVisible();

  // Les environnements s'éditent en blocs empilés, plus en tableau de sept colonnes.
  await gotoCompiled(page, '/modules');
  await expect(page.getByText('URL publique').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('columnheader', { name: 'Vient de' })).toHaveCount(0);
});
