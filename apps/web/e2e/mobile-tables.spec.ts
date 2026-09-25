import { expect, test } from '@playwright/test';
import { gotoCompiled, login } from './helpers';

/**
 * Les listes génériques sur un téléphone : `ResizableTable` se rend en lignes
 * dépliables sous le breakpoint `md`. Une seule liste suffit à tenir
 * l'assemblage (breakpoint, colonnes, dépliage, actions) : le choix du titre et
 * des colonnes est tenu par `mobile-table-layout.test.ts`.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('une liste se replie en lignes dépliables sur mobile', async ({ page }) => {
  await login(page);
  await gotoCompiled(page, '/instances');

  const row = page.getByRole('button', { name: /Atelier/, expanded: false });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('columnheader')).toHaveCount(0);

  await row.click();
  await expect(page.getByRole('button', { name: /Atelier/, expanded: true })).toBeVisible();
  await expect(page.getByText('Adresse')).toBeVisible();
  await expect(page.getByRole('button', { name: /Synchroniser/ })).toBeVisible();
});
