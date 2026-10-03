/**
 * Le vocabulaire de StepForIt Ops pour le studio vidéo (StepForIt/video-studio) : tout ce que
 * le studio a besoin de savoir du produit pour le filmer. Démarrer le mode démo, entrer, mettre
 * le parc en état, ses écrans et ses zones, nommés. Les scènes du studio n'utilisent que ces noms :
 * un écran déplacé ou un bouton renommé se corrige ICI, et toutes les vidéos suivent.
 *
 * `../.studio/kit` est déposé par le studio à chaque synchronisation (rien à installer, ignoré
 * par git). Ce fichier n'est ni compilé ni livré avec le produit : seul le studio le charge.
 * Chaque nuit, le studio rejoue ses scènes avec : si l'une casse, sa fiche le dit.
 *
 * Règle : ici la STRUCTURE (routes, api, classes antd, ports) ; dans les scènes, les TEXTES à
 * l'écran. Une zone sans entrée ici désigne `[data-studio="<nom>"]` dans l'interface.
 */
import type { Page } from '@playwright/test';
import { defineProduct } from '../.studio/kit/index.ts';

/** Ports et identifiants du mode démo : ceux de `apps/demo/scripts/env.sh`. */
const PORTS = {
  web: Number(process.env.PROMO_WEB_PORT ?? 3020),
  api: Number(process.env.PROMO_API_PORT ?? 3021),
  n8n: Number(process.env.DEMO_N8N_PORT ?? 3922),
  ai: Number(process.env.DEMO_AI_PORT ?? 3923),
};
const DEMO_AUTH = { username: 'demo', password: 'demo-promo' };
/** Posé des deux côtés : sans lui, la console affiche un bandeau « sécurité incomplète » dans chaque plan. */
const API_TOKEN = 'jeton-de-la-demo';
const API = `http://127.0.0.1:${PORTS.api}`;

/** Le workflow que la scène « Vérification » analyse devant la caméra : il arrive vierge. */
const ANALYZED_ON_CAMERA = 'commandes-dev';

const REUSE = Boolean(process.env.STUDIO_REUSE);
const DATABASE_URL = process.env.DATABASE_URL_PROMO ?? '';
if (!DATABASE_URL && !REUSE) {
  throw new Error(
    'DATABASE_URL_PROMO manquant : la capture VIDE sa base, elle doit s’appeler « …_demo ».\n' +
      '  export DATABASE_URL_PROMO=postgresql://nwm:nwm@localhost:55444/nwm_demo',
  );
}

/** Un appel direct à l'api, pour préparer un plan sans le filmer. */
async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'x-api-token': API_TOKEN, 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} : ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

type Workflow = { id: string; externalId: string };
const workflows = () => api<Workflow[]>('/workflows?_start=0&_end=200');

/** L'id plateforme d'un workflow de démo, par son id n8n (`facturation-dev`). */
async function workflowId(externalId: string): Promise<string> {
  const found = (await workflows()).find((w) => w.externalId === externalId);
  if (!found) throw new Error(`workflow de démo introuvable : ${externalId}`);
  return found.id;
}

/** Un morceau du mode démo du produit (`pnpm --filter @nwm/demo <script>`), ports alignés. */
const demo = (script: string, url: string, timeoutMs = 120_000) => ({
  name: script,
  command: `pnpm --filter @nwm/demo ${script}`,
  url,
  timeoutMs,
  env: {
    DATABASE_URL,
    WEB_PORT: String(PORTS.web),
    API_PORT: String(PORTS.api),
    DEMO_N8N_PORT: String(PORTS.n8n),
    DEMO_AI_PORT: String(PORTS.ai),
  },
});

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default defineProduct({
  name: 'StepForIt Ops',
  baseURL: `http://127.0.0.1:${PORTS.web}`,
  // La VRAIE console, lancée par son mode démo (`apps/demo`) : api compilée, console en build
  // de production, n8n et IA de façade, parc fictif. Aucun écran n'est redessiné.
  servers: [
    demo('ai', `http://127.0.0.1:${PORTS.ai}/health`),
    demo('n8n', `http://127.0.0.1:${PORTS.n8n}/health`),
    demo('api', `http://127.0.0.1:${PORTS.api}/modules`, 240_000),
    demo('web', `http://127.0.0.1:${PORTS.web}/login`, 400_000),
  ],

  /**
   * Ce qu'un parc suivi depuis des semaines a déjà : chaque workflow vérifié. Passé par la
   * VRAIE route du vérificateur, pas écrit en base : les findings affichés sont ceux que le
   * code du dépôt produit sur ces workflows.
   */
  async prepare() {
    const list = await workflows();
    for (const wf of list) {
      if (wf.externalId === ANALYZED_ON_CAMERA) continue;
      const run = await fetch(`${API}/verifier/run/${wf.id}?ai=1`, {
        method: 'POST',
        headers: { 'x-api-token': API_TOKEN, 'content-type': 'application/json' },
        body: '{}',
      });
      if (!run.ok) console.warn(`[ops] vérification de ${wf.externalId} : ${run.status}`);
    }
    console.log(`[ops] ${list.length - 1} workflows vérifiés avant la capture`);
  },

  /**
   * Une session SANS passer par l'écran de connexion : il redirige sur le tableau de bord,
   * qui estampille la visite. La scène qui le filme verrait alors « depuis 24 h » au lieu
   * des trois jours posés par le seed.
   */
  async login(page: Page) {
    const res = await page.request.post('/auth/password', { form: DEMO_AUTH, maxRedirects: 0 });
    if (res.status() >= 400) throw new Error(`connexion refusée (${res.status()})`);
  },

  // Les données arrivent par un fetch côté client, APRÈS le rendu : pas d'image tant qu'antd charge.
  busy: ['.ant-spin-spinning', '.ant-skeleton-active'],
  // L'indicateur de `next dev` et ses toasts de compilation.
  hide: 'nextjs-portal, [data-nextjs-toast], #__next-build-watcher { display: none !important; }',

  screens: {
    'tableau-de-bord': { path: '/', label: 'Tableau de bord', ready: 'kpi-executions' },
    workflows: { path: '/workflows', label: 'Workflows' },
    workflow: {
      path: async (externalId) => `/workflows/show/${await workflowId(externalId)}`,
      label: "Fiche d'un workflow",
      ready: 'onglet-schema',
    },
    erreurs: { path: '/errors', label: 'Erreurs', ready: 'graphe-erreurs' },
    'couts-llm': { path: '/llm-costs', label: 'Coûts IA', ready: 'cout-total' },
    performance: { path: '/performance', label: 'Performance' },
  },

  zones: {
    'kpi-executions': (page) => page.locator('main .dash-kpi-label', { hasText: 'Exécutions' }),
    // `dash-hero` et `dash-kpis` : posés dans l'interface (`data-studio`), sans entrée ici.
    'graphe-erreurs': (page) => page.locator('.ant-card').filter({ hasText: 'Quand ça a cassé' }),
    'cout-total': (page) => page.getByText('Coût total'),
    /** Une carte, par son titre. */
    carte: (page, titre) => page.locator('.ant-card').filter({ hasText: titre }),
    /** Une ligne de tableau, par le texte qu'elle porte. */
    ligne: (page, texte) => page.getByRole('row', { name: new RegExp(escape(texte)) }).first(),
    /** Un bouton, par son nom (les icônes antd préfixent le nom accessible : pas de nom exact). */
    bouton: (page, nom) => page.getByRole('button', { name: nom }),
    'bouton-verifier': (page) => page.getByRole('button', { name: 'Vérifier', exact: true }),
    menu: (page, nom) => page.getByRole('menuitem', { name: nom, exact: true }),
    'onglet-schema': (page) => page.getByRole('tab', { name: /Schéma/ }),
    /** L'onglet des findings, une fois l'analyse revenue avec au moins un finding. */
    'onglet-findings': (page) => page.getByRole('tab', { name: /Findings \([1-9]/ }),
    'panneau-findings': (page) => page.getByRole('tabpanel', { name: /Findings/ }),
    /** Une fenêtre modale, par un texte qu'elle contient. */
    modale: (page, texte) =>
      texte
        ? page.locator('.ant-modal-content').filter({ hasText: texte })
        : page.locator('.ant-modal-content'),
    /** Un panneau latéral, par un texte qu'il contient. */
    tiroir: (page, texte) =>
      texte
        ? page.locator('.ant-drawer-content').filter({ hasText: texte })
        : page.locator('.ant-drawer-content'),
    notification: '.ant-message-notice, .ant-notification-notice',
  },
});
