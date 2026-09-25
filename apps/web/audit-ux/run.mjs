/**
 * Le parcours : ouvre chaque écran de `screens.mjs` en desktop puis en mobile,
 * joue les sondes de `probes.mjs`, écrit `measures.json` au fur et à mesure, et
 * rend le rapport par `report.mjs`.
 *
 *   pnpm audit:ux -- --env=local
 *   pnpm audit:ux -- --env=staging --headed
 *   pnpm audit:ux -- --report-only        (rejoue le jugement sur les mesures)
 *   pnpm audit:ux -- --warmup             (précompile les routes avant de mesurer)
 *   pnpm audit:ux -- --check-map          (la carte est-elle à jour du registre ?)
 *
 * LECTURE SEULE, strictement : on navigue par URL, on suit des liens, on ouvre
 * des formulaires — on ne remplit rien, on ne soumet rien, on ne supprime rien.
 * Un garde-fou réseau (`ABORT_WRITES`) coupe toute requête sortante en POST /
 * PUT / PATCH / DELETE vers l'API, sauf celle de connexion : si une sonde
 * déclenchait une écriture par accident, la requête n'arrive jamais.
 *
 * Un écran qu'on n'atteint pas (module désactivé, droits manquants, 404) est
 * noté « non atteint » AVEC sa raison : ce n'est pas un échec de l'audit, c'est
 * une mesure. Et les mesures sont écrites après CHAQUE écran — un parcours
 * interrompu garde ce qu'il a déjà vu.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCREENS } from './screens.mjs';
import { loadEnvProfile } from './envs.mjs';
import {
  measureDensity,
  measureForm,
  measureStates,
  measureA11yExtras,
  measureAxe,
  measureGlobalSearch,
} from './probes.mjs';
import { writeReport } from './report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Le chemin d'une requête, avec son HÔTE quand elle sort de l'application.
 *
 * Ne garder que le chemin a coûté une enquête : un appel en échec sur
 * « /telemetry » ressemble à une route de la console, alors qu'il part chez un
 * tiers. Ce qui sort du domaine doit se voir dans la mesure elle-même.
 */
function requestLabel(rawUrl, baseUrl) {
  const url = new URL(rawUrl);
  return url.origin === new URL(baseUrl).origin ? url.pathname : `${url.origin}${url.pathname}`;
}
const REPO = resolve(HERE, '../../..');

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

/** Les méthodes qui ÉCRIVENT. Le parcours n'en émet aucune ; le garde le prouve. */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** La seule exception : ouvrir la session. Sans elle, il n'y a rien à auditer. */
const LOGIN_PATHS = ['/auth/password', '/auth/google'];

function parseArgs(argv) {
  const args = { env: 'local', headed: false, reportOnly: false, checkMap: false, only: null, warmup: false };
  for (const raw of argv.slice(2)) {
    if (raw === '--headed') args.headed = true;
    else if (raw === '--report-only') args.reportOnly = true;
    else if (raw === '--check-map') args.checkMap = true;
    else if (raw === '--warmup') args.warmup = true;
    else if (raw.startsWith('--env=')) args.env = raw.slice('--env='.length);
    else if (raw.startsWith('--only=')) args.only = raw.slice('--only='.length).split(',');
  }
  return args;
}

/**
 * La carte contre le registre : tout `list:` de `refine-app.tsx` doit avoir son
 * écran ici. C'est le seul point où l'outil lit le code de l'application, et il
 * le fait pour SIGNALER un écart, jamais pour se réparer tout seul — un audit
 * qui se met à jour en silence perd la comparaison entre deux rapports datés.
 */
function checkMap() {
  const source = readFileSync(join(REPO, 'apps/web/src/app/refine-app.tsx'), 'utf8');
  const registered = [...source.matchAll(/^\s*list: '([^']+)'/gm)].map((m) => m[1]);
  const known = new Set(SCREENS.map((s) => s.path));
  const missing = registered.filter((p) => !known.has(p));
  const pagesDir = join(REPO, 'apps/web/src/app');
  console.log(`Registre : ${registered.length} listes · carte : ${SCREENS.length} écrans`);
  if (missing.length) {
    console.error(`\nÉcrans du registre absents de la carte :\n  ${missing.join('\n  ')}`);
    console.error(`\nAjoute-les dans ${join(HERE, 'screens.mjs')} (source : ${pagesDir}).`);
    process.exitCode = 1;
    return;
  }
  console.log('Carte à jour.');
}

/** Ouvre la session une fois ; la suite réutilise le storageState. */
async function openSession(browser, profile) {
  const context = await browser.newContext({ baseURL: profile.baseUrl });
  const page = await context.newPage();
  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  // `AUTH_OPTIONAL=1` (dev local) : la console s'ouvre sans connexion, et
  // `/login` redirige. Rien à faire, la session est déjà bonne.
  if (!page.url().includes('/login')) {
    const state = await context.storageState();
    await context.close();
    return { state, mode: 'ouverte (AUTH_OPTIONAL)' };
  }

  if (!profile.username || !profile.password) {
    await context.close();
    throw new Error(
      `Connexion requise sur ${profile.baseUrl} mais AUDIT_USERNAME / AUDIT_PASSWORD manquent.\n` +
        `Renseigne-les dans ${join(HERE, '.env')} (modèle : .env.example).`,
    );
  }

  await page.fill('input[name="username"]', profile.username);
  await page.fill('input[name="password"]', profile.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  const state = await context.storageState();
  await context.close();
  return { state, mode: 'identifiant / mot de passe' };
}

/** Le garde en lecture seule, posé sur le contexte : une écriture n'arrive jamais. */
async function guardReadOnly(context, blocked) {
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (!WRITE_METHODS.has(request.method())) return route.continue();
    const url = new URL(request.url());
    if (LOGIN_PATHS.some((p) => url.pathname.startsWith(p))) return route.continue();
    blocked.push(`${request.method()} ${url.pathname}`);
    return route.abort('blockedbyclient');
  });
}

/**
 * Attend que le serveur réponde. Un environnement de développement peut mourir et
 * redémarrer au milieu d'un parcours (`next dev` tient mal une trentaine de routes
 * lourdes compilées à la suite), et un écran noté « non atteint » pour cette
 * raison-là ne dit rien de l'écran. On attend le retour, puis on réessaie.
 */
async function waitForServer(page, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await page.request
      .get('/login', { timeout: 10_000 })
      .then((r) => r.status() < 500)
      .catch(() => false);
    if (ok) return true;
    await page.waitForTimeout(2_000);
  }
  return false;
}

/** Ouvre un écran et joue toutes les sondes. Rend `{ reached, reason?, ... }`. */
async function auditScreen(context, screen, viewportName, shotsDir, baseUrl) {
  const page = await context.newPage();
  const consoleErrors = [];
  const failed = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('requestfailed', (req) => {
    // Une requête ANNULÉE n'est pas une requête en échec : Next préfetche les
    // liens au survol et abandonne ces appels quand on quitte la page. Les
    // compter ferait un constat sur une optimisation qui fonctionne.
    const reason = req.failure()?.errorText ?? '';
    if (reason.includes('ERR_ABORTED')) return;
    failed.push({ status: `échec réseau (${reason})`, url: requestLabel(req.url(), baseUrl) });
  });
  page.on('response', (res) => {
    // Un 401 sur un écran de la console est une panne de session, pas du bruit ;
    // un 404 sur une ressource d'un module éteint en est. On garde tout et on
    // laisse `thresholds.mjs` trancher.
    if (res.status() >= 400) failed.push({ status: res.status(), url: requestLabel(res.url(), baseUrl) });
  });

  const result = { screen: screen.id, viewport: viewportName, reached: false };
  const started = Date.now();

  try {
    let path = screen.path;

    // Écran de détail : on tire une adresse réelle de la liste d'où il dépend.
    if (screen.reach === 'record') {
      await page.goto(screen.from, { waitUntil: 'domcontentloaded' });
      const link = page.locator(screen.link).first();
      const href = await link.getAttribute('href', { timeout: 15_000 }).catch(() => null);
      if (!href) {
        result.reason = `aucun enregistrement dans ${screen.from} : rien à ouvrir`;
        await page.close();
        return result;
      }
      path = screen.rewrite ? screen.rewrite(href) : href;
      result.resolvedPath = path;
    }

    let response = await page
      .goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      .catch(() => null);
    if (!response) {
      // Le serveur a peut-être disparu sous nous : on l'attend et on réessaie UNE
      // fois. Deux échecs de suite, en revanche, parlent bien de l'écran.
      result.serverRestart = await waitForServer(page);
      response = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => null);
      if (!response) {
        result.reason = `injoignable après attente du serveur : ${path}`;
        await page.close();
        return result;
      }
    }
    if (response.status() >= 400) {
      result.reason = `HTTP ${response.status()} sur ${path}`;
      await page.close();
      return result;
    }
    if (page.url().includes('/login')) {
      result.reason = 'redirigé vers /login : session absente';
      await page.close();
      return result;
    }

    // Le contenu vient d'un fetch côté client : on attend qu'il soit posé,
    // borné. Un écran qui n'arrive jamais à ce point est une mesure en soi.
    await page
      .waitForFunction(
        () =>
          document.querySelectorAll(
            '.ant-table, .ant-form, .ant-card, .ant-empty, .ant-result, .ant-descriptions',
          ).length > 0,
        null,
        { timeout: 20_000 },
      )
      .catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    result.reached = true;
    result.path = path;
    result.openMs = Date.now() - started;
    result.density = await measureDensity(page);
    result.states = await measureStates(page);
    result.a11y = await measureA11yExtras(page);
    if (screen.kind === 'form' || screen.kind === 'detail') result.form = await measureForm(page);
    result.axe = await measureAxe(page).catch((e) => ({ error: String(e), violations: [] }));

    mkdirSync(shotsDir, { recursive: true });
    const shot = join(shotsDir, `${screen.id}.${viewportName}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    result.screenshot = shot.replace(`${REPO}/`, '');
  } catch (error) {
    result.reason = `échec d'ouverture : ${String(error).split('\n')[0]}`;
  }

  result.console = { errors: consoleErrors.slice(0, 10) };
  result.network = { failed: failed.slice(0, 10) };
  await page.close();
  return result;
}

/** Les contrôles de flux : historique, adresses profondes, recherche globale. */
async function auditFlow(context) {
  const page = await context.newPage();
  const flow = { deepLinks: [] };

  try {
    await page.goto('/workflows', { waitUntil: 'domcontentloaded' });
    const before = page.url();
    const link = page.locator('a[href^="/workflows/show/"]').first();
    const href = await link.getAttribute('href', { timeout: 15_000 }).catch(() => null);
    if (href) {
      await page.goto(href, { waitUntil: 'domcontentloaded' });
      await page.goBack({ waitUntil: 'domcontentloaded' });
      flow.backFrom = new URL(before).pathname;
      flow.backTo = new URL(page.url()).pathname;
      flow.backRestores = flow.backTo === flow.backFrom;

      // L'adresse profonde, rechargée à froid : c'est celle qu'on colle en ticket.
      const deep = await page.goto(href, { waitUntil: 'domcontentloaded' });
      const ok = Boolean(deep && deep.status() < 400) && !page.url().includes('/login');
      flow.deepLinks.push({
        path: href,
        ok,
        detail: ok ? `HTTP ${deep?.status()}` : `HTTP ${deep?.status()} / ${page.url()}`,
      });
    } else {
      flow.backRestores = null;
      flow.reason = 'aucun workflow en base : historique et adresse profonde non vérifiables';
    }

    await page.goto('/workflows', { waitUntil: 'domcontentloaded' });
    flow.globalSearch = await measureGlobalSearch(page);
  } catch (error) {
    flow.error = String(error).split('\n')[0];
  }

  await page.close();
  return flow;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.checkMap) return checkMap();

  const profile = loadEnvProfile(args.env, HERE);
  const outDir = join(HERE, '.out', args.env);
  const measuresPath = join(outDir, 'measures.json');
  mkdirSync(outDir, { recursive: true });

  if (args.reportOnly) {
    if (!existsSync(measuresPath))
      throw new Error(`Aucune mesure à relire : ${measuresPath} n'existe pas. Joue d'abord le parcours.`);
    const measures = JSON.parse(readFileSync(measuresPath, 'utf8'));
    const path = writeReport(measures, REPO);
    console.log(`Rapport : ${path}`);
    return;
  }

  const browser = await chromium.launch({ headless: !args.headed });
  const session = await openSession(browser, profile);
  console.log(`Session : ${session.mode} · cible ${profile.baseUrl}`);

  const measures = {
    env: args.env,
    baseUrl: profile.baseUrl,
    startedAt: new Date().toISOString(),
    session: session.mode,
    screens: [],
    blockedWrites: [],
  };
  const save = () => writeFileSync(measuresPath, JSON.stringify(measures, null, 2));

  const wanted = args.only ? SCREENS.filter((s) => args.only.includes(s.id)) : SCREENS;
  // Une cible locale est servie par `next dev` : le temps d'ouverture y mesure
  // la compilation autant que l'écran, le rapport ne le juge donc pas.
  measures.devServer = /localhost|127\.0\.0\.1/.test(profile.baseUrl);

  // Passe de chauffe, sur demande (`--warmup`) et jamais par défaut.
  //
  // Elle visait à sortir le temps de COMPILATION du temps d'ouverture mesuré :
  // `next dev` compile chaque route à sa première visite. Elle coûte pourtant
  // plus qu'elle ne rapporte — compiler trente routes à la suite fait franchir
  // au serveur son propre seuil mémoire (« Server is approaching the used memory
  // threshold, restarting… »), et la chauffe repart alors de zéro sans jamais
  // finir. Le temps d'ouverture n'étant de toute façon PAS jugé contre un
  // serveur de développement (cf. `thresholds.mjs`), on ne paie plus ce prix.
  // Contre un build de production, où le chiffre compte, `--warmup` la rétablit.
  if (args.warmup) {
    const warm = await browser.newContext({ baseURL: profile.baseUrl, storageState: session.state });
    await guardReadOnly(warm, measures.blockedWrites);
    const page = await warm.newPage();
    process.stdout.write('  chauffe des routes … ');
    for (const screen of wanted.filter((s) => s.path)) {
      const ok = await page
        .goto(screen.path, { waitUntil: 'domcontentloaded', timeout: 90_000 })
        .then(() => true)
        .catch(() => false);
      if (!ok) await waitForServer(page);
    }
    await warm.close();
    measures.warmedUp = true;
    console.log('ok');
  }

  for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
    const context = await browser.newContext({
      baseURL: profile.baseUrl,
      viewport,
      storageState: viewportName === 'desktop' ? session.state : session.state,
      isMobile: viewportName === 'mobile',
      hasTouch: viewportName === 'mobile',
    });
    await guardReadOnly(context, measures.blockedWrites);

    for (const screen of wanted) {
      // `/login` ne se mesure qu'une fois la session fermée : hors parcours.
      if (screen.auth === 'none' && viewportName === 'mobile') continue;
      process.stdout.write(`  ${viewportName.padEnd(7)} ${screen.id} … `);
      const result = await auditScreen(
        context,
        screen,
        viewportName,
        join(outDir, 'screenshots'),
        profile.baseUrl,
      );
      measures.screens.push(result);
      save(); // Après CHAQUE écran : un parcours interrompu garde ce qu'il a vu.
      console.log(
        result.reached ? `${result.openMs} ms` : `non atteint (${result.reason ?? 'raison inconnue'})`,
      );
    }

    if (viewportName === 'desktop') {
      process.stdout.write('  flux    navigation … ');
      measures.flow = await auditFlow(context);
      save();
      console.log('ok');
    }

    await context.close();
  }

  measures.finishedAt = new Date().toISOString();
  save();
  await browser.close();

  if (measures.blockedWrites.length)
    console.warn(
      `\n/!\\ ${measures.blockedWrites.length} écriture(s) bloquée(s) par le garde — une sonde écrit, ` +
        `à corriger :\n  ${measures.blockedWrites.join('\n  ')}`,
    );

  const reportPath = writeReport(measures, REPO);
  console.log(`\nMesures : ${measuresPath}`);
  console.log(`Rapport : ${reportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
