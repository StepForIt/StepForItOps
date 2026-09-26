import { defineConfig, devices } from '@playwright/test';

/**
 * Les parcours de bout en bout : un navigateur, la console, l'api, la base.
 *
 * C'est le seul niveau qui traverse le proxy `/backend/*`, le middleware
 * d'authentification et le dataProvider Refine — trois choses qui vivent
 * ENTRE le front et l'api, et qu'aucun test des deux côtés ne voit. Le prix est
 * connu (deux serveurs, une base, un navigateur), d'où un nombre de parcours
 * volontairement petit : ce qui casse ici doit être ce qui casse la console
 * entière, pas un détail d'affichage — un composant se teste moins cher.
 *
 * L'authentification est ACTIVE (identifiant/mot de passe), contrairement au dev
 * local : la connexion est le premier parcours de tout le monde, et
 * `AUTH_OPTIONAL=1` la rendrait invisible aux tests.
 */
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3010);
const API_PORT = Number(process.env.E2E_API_PORT ?? 3011);
const FAKE_N8N_PORT = Number(process.env.FAKE_N8N_PORT ?? 3912);
const FAKE_AI_PORT = Number(process.env.FAKE_ANTHROPIC_PORT ?? 3913);
const DATABASE_URL = process.env.DATABASE_URL_TEST ?? '';
if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL_TEST manquant : les parcours ont besoin d'une base jetable, jamais celle de dev.\n" +
      '  docker run -d --name nwm-test-pg -e POSTGRES_USER=nwm -e POSTGRES_PASSWORD=nwm \\\n' +
      '    -e POSTGRES_DB=nwm_test -p 55444:5432 postgres:16-alpine\n' +
      '  export DATABASE_URL_TEST=postgresql://nwm:nwm@localhost:55444/nwm_test',
  );
}

const AUTH = {
  APP_USERNAME: 'e2e',
  APP_PASSWORD: 'mot-de-passe-e2e',
  SESSION_SECRET: 'secret-de-test-e2e',
};

export default defineConfig({
  testDir: './e2e',
  // La base est partagée par les parcours : les paralléliser les ferait se
  // marcher dessus pour un gain de quelques secondes.
  workers: 1,
  fullyParallel: false,
  // Un parcours qui ne passe qu'au second essai est un parcours qui ne passe
  // pas : le retry cacherait exactement ce qu'on veut voir.
  retries: 0,
  // `next dev` COMPILE chaque route à sa première visite : c'est fait une fois
  // pour toutes avant le premier test (`e2e/global-setup.ts`), sinon cette
  // compilation seule mangeait la minute d'un test sur un runner de CI.
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  // 15 s et non 10 : ces parcours attendent des données servies par une api et
  // une base démarrées pour l'occasion, sur une machine partagée avec le reste
  // de la CI. Ce qui est attendu reste précis — une ligne, une colonne, un
  // texte —, seul le temps qu'on lui laisse tient compte de l'hôte.
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Les parcours lisent les libellés français : Chromium annoncerait sinon `en-US`.
    locale: 'fr-FR',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Le fournisseur d'IA de façade. Aucun crochet dans le code applicatif :
      // le SDK Anthropic lit `ANTHROPIC_BASE_URL` de lui-même, et c'est cette
      // variable que l'api reçoit ci-dessous.
      command: `node e2e/fake-anthropic.mjs`,
      url: `http://127.0.0.1:${FAKE_AI_PORT}/v1/messages`,
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
      env: { FAKE_ANTHROPIC_PORT: String(FAKE_AI_PORT) },
    },
    {
      // Démarré avant l'api : c'est lui que l'instance du jeu d'essai désigne.
      command: `node e2e/fake-n8n.mjs`,
      url: `http://127.0.0.1:${FAKE_N8N_PORT}/api/v1/workflows`,
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
      env: { FAKE_N8N_PORT: String(FAKE_N8N_PORT) },
    },
    {
      // L'api compilée, comme en production — et non `nest start --watch`, dont
      // le rechargement à chaud n'a rien à faire dans un test.
      //
      // Le schéma et le jeu d'essai sont posés ICI, dans la même commande, et
      // non par un `globalSetup` : Playwright démarre ses serveurs AVANT lui, et
      // l'api mourait alors sur une base vide (`ModuleState` n'existe pas). Les
      // deux vivent dans `apps/api`, où Prisma est généré — le web n'a aucune
      // raison de connaître le schéma de la base.
      command:
        'pnpm --filter @nwm/api build && ' +
        'pnpm --filter @nwm/api exec prisma db push --skip-generate --accept-data-loss && ' +
        'node apps/api/scripts/seed-e2e.mjs && ' +
        'node apps/api/dist/apps/api/src/main.js',
      cwd: '../..',
      url: `http://127.0.0.1:${API_PORT}/modules`,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: {
        DATABASE_URL,
        API_PORT: String(API_PORT),
        FAKE_N8N_PORT: String(FAKE_N8N_PORT),
        // La clé fait exister le fournisseur ; l'URL le remplace par le nôtre.
        ANTHROPIC_API_KEY: 'cle-de-test-e2e',
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${FAKE_AI_PORT}`,
      },
    },
    {
      // `next dev` et non le build autonome : celui-ci fige `API_INTERNAL_URL`
      // au build, et le port de l'api changerait alors d'un run à l'autre sans
      // que la console le suive.
      command: `pnpm --filter @nwm/web exec next dev -p ${WEB_PORT}`,
      cwd: '../..',
      url: `http://127.0.0.1:${WEB_PORT}/login`,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      // Ses « Compiling … » dans le log : sans eux, un parcours lent en CI ne
      // dit pas si `next dev` compilait, se relançait ou attendait l'api.
      stdout: 'pipe',
      env: {
        ...AUTH,
        API_INTERNAL_URL: `http://127.0.0.1:${API_PORT}`,
        // Un dossier de build à part : une session de dev ouverte sur le même
        // dépôt garde le sien.
        NEXT_DIST_DIR: '.next-e2e',
        // `next dev` se relance seul près de son plafond de heap (« approaching the used memory
        // threshold, restarting ») : en plein parcours, la page suivante tombait sur un port fermé
        // puis sur une recompilation à froid, et dépassait les 60 s.
        NODE_OPTIONS: '--max-old-space-size=4096',
        // Une page compilée le reste jusqu'à la fin des parcours (cf. next.config.js).
        NEXT_KEEP_COMPILED_PAGES: '1',
      },
    },
  ],
});
