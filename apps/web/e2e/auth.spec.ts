import { expect, test } from '@playwright/test';
import { CREDENTIALS, login } from './helpers';

/**
 * La connexion — le premier parcours de tout le monde, et le seul endroit où le
 * middleware décide quelque chose. Une installation vierge n'est JAMAIS ouverte :
 * c'est une promesse de sécurité, elle mérite d'être tenue par un test.
 */
test.describe('connexion', () => {
  test('renvoie une page protégée vers la connexion, et y revient après', async ({ page }) => {
    await page.goto('/workflows');

    await expect(page).toHaveURL(/\/login/);
    // Le chemin demandé est retenu : arriver sur l'accueil ferait recommencer la
    // navigation à celui qui suivait un lien.
    expect(new URL(page.url()).searchParams.get('next')).toBe('/workflows');

    await page.fill('input[name="username"]', CREDENTIALS.username);
    await page.fill('input[name="password"]', CREDENTIALS.password);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/workflows/);
  });

  test('refuse un mauvais mot de passe', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="username"]', CREDENTIALS.username);
    await page.fill('input[name="password"]', 'pas-le-bon');
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('.ant-alert')).toBeVisible();
  });

  test('l’API n’est pas joignable à travers le proxy sans session', async ({ request }) => {
    // Le middleware garde les pages ET `/backend/*` : un 401 JSON, et non une
    // redirection HTML que l'UI ne saurait pas lire.
    const response = await request.get('/backend/workflows');
    expect(response.status()).toBe(401);
  });

  test('une session ouverte traverse le proxy', async ({ page }) => {
    await login(page);
    const response = await page.request.get('/backend/workflows');
    expect(response.status()).toBe(200);
  });
});
