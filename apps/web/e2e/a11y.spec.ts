import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login } from './helpers';

/**
 * La mesure d'accessibilité, rejouée par la CI (job « parcours · navigateur »,
 * seul niveau qui a la base, chromium et la console assemblée derrière la
 * session). Le ticket parle d'un outillage `audit:ux` et d'un rapport daté qui
 * n'ont jamais existé dans le repo ; cette spec les remplace par une GARDE
 * déterministe : axe rejoué sur des écrans représentatifs, échec au moindre
 * retour des violations que ce lot répare.
 *
 * Les assertions portent sur les RÈGLES corrigées ici et non sur tout axe : un
 * audit total remonterait aussi des points hors périmètre (markup interne
 * antd/Refine — cf. docs/audit-ux/README.md) et rendrait la garde instable.
 * Le jour où ces points sont traités, on élargit la liste des règles.
 */

// Règles « nommer les contrôles » que ce lot répare partout où le contrôle est
// à nous : encarts injectés dans le menu, switches, boutons-icône, recherche.
const FIXED_RULES = ['aria-required-children', 'button-name', 'aria-command-name'] as const;

/** Écrans représentatifs : le menu latéral (donc ces règles) est sur les 29. */
const SCREENS: { name: string; path: string }[] = [
  { name: 'Workflows', path: '/workflows' },
  { name: 'Modules', path: '/modules' },
];

test.describe('accessibilité — contrôles nommés', () => {
  for (const screen of SCREENS) {
    test(`${screen.name} : aucune violation des règles réparées`, async ({ page }) => {
      await login(page);
      await page.goto(screen.path);
      // Le menu latéral est servi après hydratation (fetch côté client) : on
      // attend un contrôle qui n'existe QUE dans ce menu — le bouton
      // « Rechercher » des encarts — plutôt qu'un délai, sinon axe scanne un
      // squelette sans les nœuds que ce lot répare.
      await expect(page.getByRole('button', { name: 'Rechercher' })).toBeVisible();

      const results = await new AxeBuilder({ page }).withRules([...FIXED_RULES]).analyze();

      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });
  }
});
