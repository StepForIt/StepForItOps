import { defineConfig } from 'vitest/config';

// Les parcours Playwright (`e2e/`) ont leur propre runner : vitest ne joue que les tests unitaires du code,
// fonctions PURES seulement (`.test.ts` comme `.spec.ts`, à côté du code qu'ils couvrent).
export default defineConfig({
  test: { include: ['src/**/*.test.ts', 'src/**/*.spec.ts'] },
});
