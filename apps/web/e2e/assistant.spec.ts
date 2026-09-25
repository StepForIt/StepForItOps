import { expect, test } from '@playwright/test';
import { login, showOnePerWorkflow } from './helpers';

/**
 * Le tiroir de l'assistant, de bout en bout.
 *
 * C'était le seul écran de la console qu'aucun parcours ne traversait, et pour
 * une raison de fond : il lui faut un fournisseur d'IA joignable, or une vraie
 * clé dans la CI, ce serait un appel facturé et non déterministe à chaque
 * exécution. Un faux fournisseur règle les deux (`fake-anthropic.mjs`), et rien
 * n'est branché dans le code applicatif pour cela — le SDK Anthropic lit
 * `ANTHROPIC_BASE_URL` de lui-même.
 *
 * Ce qui est vérifié est le CHEMIN, jamais la qualité d'un modèle : la demande
 * part, la réponse revient dans le fil, la proposition devient un diff relisible
 * — trois maillons qui traversent le proxy, l'api, la porte de la proposition et
 * le miroir, et qu'aucun test des deux côtés ne voit ensemble.
 */
test.describe('l’assistant', () => {
  test('répond dans le fil et propose une modification relisible', async ({ page }) => {
    // Le tiroir monte le fil, la saisie et la revue : sur un runner, la première
    // compilation de cette page dépasse le budget ordinaire d'un parcours.
    test.setTimeout(150_000);
    await login(page);
    await page.goto('/workflows');
    // La vue plate porte les noms en lien : c'est de la page d'un workflow que
    // l'assistant s'ouvre.
    await showOnePerWorkflow(page);
    await page.getByRole('link', { name: 'Relances clients' }).first().click();
    await page.waitForURL(/\/workflows\/(show|view)\//, { timeout: 120_000 });

    await page.getByRole('button', { name: 'Assistant IA' }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText(/Assistant IA/).first()).toBeVisible();

    const input = drawer.getByPlaceholder(/Question ou modification/);
    await input.fill('Le nom du déclencheur est-il clair ?');
    await input.press('Enter');

    // La réponse arrive dans le fil : sans elle, la demande semblerait perdue.
    await expect(drawer.getByText(/Départ manuel/).first()).toBeVisible({ timeout: 60_000 });

    // Et la modification proposée est relisible AVANT d'être écrite : c'est
    // toute la promesse de l'assistant — rien ne part dans n8n sans revue.
    await expect(drawer.getByRole('button', { name: /diff/i }).first()).toBeVisible();
  });
});
