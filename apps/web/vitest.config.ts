import { defineConfig } from 'vitest/config';

// Les parcours Playwright (`e2e/`) ont leur propre runner : vitest ne joue que les tests unitaires du code.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
});
