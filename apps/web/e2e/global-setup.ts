import type { FullConfig } from '@playwright/test';
import { CREDENTIALS } from './helpers';

/**
 * Les routes que les parcours visitent, pages et route handlers. Une route
 * dynamique se compile une fois pour tous ses ids : celui-ci n'a pas à exister.
 */
const ROUTES = [
  '/',
  '/workflows',
  '/workflows/show/prechauffage',
  '/versions',
  '/monitors',
  '/findings',
  '/modules',
  '/app-logs',
  '/resources',
  '/instances',
  // Appelées par la mise en page de chaque écran. Compilées en plein parcours,
  // elles reconstruisaient le graphe client de toutes les pages gardées.
  '/api/security-status',
  '/auth/me',
];

/**
 * Compile d'avance les routes des parcours.
 *
 * `next dev` compile une route à sa première visite, et sur un runner de CI
 * cette compilation seule mangeait la minute d'un test — un `goto` qui expire
 * dans un `beforeEach`, sans rien dire de l'écran. Playwright démarre ses
 * serveurs AVANT ce setup : `next dev` répond déjà. La session est ouverte
 * par la vraie route de connexion, sinon le middleware renverrait chaque route
 * sur `/login` et ne compilerait que celle-là. Ce préchauffage ne vaut que parce
 * que `NEXT_KEEP_COMPILED_PAGES` empêche `next dev` de décharger ensuite une
 * route inactive (cf. `next.config.js`).
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = String(config.projects[0].use.baseURL);
  const cookie = await openSession(baseURL);

  const started = Date.now();
  // Ensemble : `next dev` regroupe les routes demandées en même temps dans une
  // seule passe du compilateur.
  const results = await Promise.all(
    ROUTES.map(async (route) => {
      const res = await fetch(new URL(route, baseURL), { headers: { cookie }, redirect: 'manual' });
      await res.arrayBuffer();
      return `${route} ${res.status}`;
    }),
  );
  console.log(`[préchauffage] ${Math.round((Date.now() - started) / 1000)} s — ${results.join(', ')}`);
}

async function openSession(baseURL: string): Promise<string> {
  const form = new FormData();
  form.set('username', CREDENTIALS.username);
  form.set('password', CREDENTIALS.password);
  const res = await fetch(new URL('/auth/password', baseURL), {
    method: 'POST',
    body: form,
    redirect: 'manual',
  });
  const session = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('nwm_session='));
  if (!session) throw new Error(`préchauffage : connexion refusée (${res.status})`);
  return session;
}
