import { readFile } from 'node:fs/promises';
import { Page, expect, test } from '@playwright/test';
import { login } from './helpers';

/**
 * La clé d'export, de bout en bout : générée à chaque téléchargement et montrée
 * une seule fois, le fichier ne part qu'une fois la clé déclarée rangée ; il ne
 * porte ses secrets que scellés, et il ne se rouvre qu'avec elle — export de
 * configuration comme sauvegarde complète. La cryptographie est tenue par les
 * tests de l'api ; ce parcours tient l'assemblage : le POST de l'export et le
 * FORMULAIRE de la sauvegarde à travers le proxy `/backend/*`, l'en-tête de la
 * clé au téléversement, et la console qui redemande la clé d'un fichier scellé.
 */
/** Ouvre la fenêtre de la clé, la relit, la déclare rangée, et rend clé + fichier. */
async function downloadWithKey(page: Page, button: string): Promise<{ key: string; path: string }> {
  await page.getByRole('button', { name: button }).click();
  const dialog = page.getByRole('dialog', { name: "Votre clé d'export" });
  const key = (await dialog.getByTestId('export-key-value').textContent())!.trim();
  const download = dialog.getByRole('button', { name: 'Télécharger' });
  // Pas de fichier sans clé rangée : un fichier dont personne n'a la clé est perdu.
  await expect(download).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /J'ai rangé cette clé/ }).check();
  const [file] = await Promise.all([page.waitForEvent('download'), download.click()]);
  await expect(dialog).toBeHidden();
  return { key, path: (await file.path())! };
}

test.describe("la clé d'export", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('scelle la configuration exportée et ne la rouvre qu’avec la même clé', async ({ page }) => {
    await page.goto('/config-transfer');
    const { key, path } = await downloadWithKey(page, 'Télécharger la configuration');
    expect(key).toMatch(/^[a-z2-9]{5}(-[a-z2-9]{5}){3}$/);
    const bundle = JSON.parse(await readFile(path, 'utf8'));
    expect(bundle.sealed.kdf).toBe('scrypt');
    expect(bundle.instances[0].apiKey).toMatch(/^xenc:v1:/);

    await page.locator('#config-import-file').setInputFiles(path);
    const prompt = page.locator('.ant-alert', { hasText: 'Fichier scellé' });
    await prompt.getByLabel("Clé d'export du fichier").fill('une-autre-cle-longue');
    await prompt.getByRole('button', { name: 'Ouvrir le fichier' }).click();
    await expect(page.getByText(/Clé d'export incorrecte/)).toBeVisible();

    await prompt.getByLabel("Clé d'export du fichier").fill(key);
    await prompt.getByRole('button', { name: 'Ouvrir le fichier' }).click();
    await expect(page.getByText(/Prévisualisation de/)).toBeVisible();
  });

  test('scelle la sauvegarde complète et la redemande à la restauration', async ({ page }) => {
    await page.goto('/config-transfer');
    const { key, path } = await downloadWithKey(page, 'Télécharger la sauvegarde complète');
    const bytes = await readFile(path);
    expect(bytes.subarray(0, 8).toString()).toBe('NWMSEAL1');

    await page.locator('#backup-restore-file').setInputFiles(path);
    const prompt = page.locator('.ant-alert', { hasText: 'Sauvegarde scellée' });
    await prompt.getByLabel("Clé d'export du fichier").fill(key);
    await prompt.getByRole('button', { name: 'Ouvrir le fichier' }).click();
    await expect(page.getByText(/sauvegarde du .*lignes/)).toBeVisible();
  });
});
