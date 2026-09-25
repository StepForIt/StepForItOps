/**
 * La carte des écrans de la console — la SOURCE de ce que l'audit parcourt.
 *
 * Elle est recopiée de `apps/web/src/app/refine-app.tsx` (tableau `RESOURCES`),
 * qui est le registre unique du menu, et complétée des écrans qui n'y figurent
 * pas : la home, les formulaires create/edit, les pages de détail, et les deux
 * écrans hors console (login, setup).
 *
 * Elle est RECOPIÉE et non lue : le registre est du TSX, il embarque des icônes
 * React, et l'audit doit pouvoir tourner contre un environnement déployé dont
 * le code n'est pas celui du dépôt. Le prix est une synchronisation à la main —
 * `npm run audit:ux -- --check-map` la vérifie et échoue si un `list:` du
 * registre n'a pas son écran ici.
 *
 * Champs :
 *   id      identifiant stable, sert de nom de capture et de clé de comparaison
 *           entre deux rapports datés
 *   label   ce que l'humain lit dans le rapport
 *   path    l'adresse, ou `null` quand l'écran ne s'atteint que par un clic
 *   reach   'url' (adressable, rechargeable) | 'menu' (clic) | 'record' (a
 *           besoin qu'un enregistrement existe : l'id est résolu au parcours)
 *   kind    'dashboard' | 'list' | 'form' | 'detail' — décide des sondes jouées
 *   module  l'id du module métier qui la sert, quand elle est désactivable :
 *           écran absent ⇒ « non atteint », jamais un échec
 *   from    pour reach 'record' : l'écran de liste d'où l'on tire un id
 *   link    pour reach 'record' : le sélecteur du lien à suivre dans cette liste
 *   auth    'none' quand l'écran vit hors session (login, setup)
 */
export const SCREENS = [
  // ---- Hors console -------------------------------------------------------
  { id: 'login', label: 'Connexion', path: '/login', reach: 'url', kind: 'form', auth: 'none' },

  // ---- Premier niveau -----------------------------------------------------
  { id: 'home', label: 'Accueil', path: '/', reach: 'url', kind: 'dashboard', module: 'dashboard' },
  { id: 'workflows', label: 'Workflows', path: '/workflows', reach: 'url', kind: 'list' },
  { id: 'versions', label: 'Versions', path: '/versions', reach: 'url', kind: 'list', module: 'versioning' },
  {
    id: 'workflow-map',
    label: 'Carte workflows',
    path: '/workflow-map',
    reach: 'url',
    kind: 'list',
    module: 'dep-graph',
  },

  // ---- Qualité ------------------------------------------------------------
  { id: 'findings', label: 'Findings', path: '/findings', reach: 'url', kind: 'list' },
  { id: 'test-runs', label: 'Tests', path: '/test-runs', reach: 'url', kind: 'list', module: 'tester' },

  // ---- Santé --------------------------------------------------------------
  {
    id: 'monitors',
    label: 'Monitoring',
    path: '/monitors',
    reach: 'url',
    kind: 'list',
    module: 'monitoring',
  },
  {
    id: 'monitors-create',
    label: 'Nouveau monitor',
    path: '/monitors/create',
    reach: 'url',
    kind: 'form',
    module: 'monitoring',
  },
  { id: 'errors', label: 'Erreurs', path: '/errors', reach: 'url', kind: 'list', module: 'monitoring' },
  {
    id: 'performance',
    label: 'Performance',
    path: '/performance',
    reach: 'url',
    kind: 'list',
    module: 'performance',
  },
  { id: 'llm-costs', label: 'Coûts IA', path: '/llm-costs', reach: 'url', kind: 'list', module: 'ai-cost' },
  {
    id: 'model-audit',
    label: 'Modèles IA',
    path: '/model-audit',
    reach: 'url',
    kind: 'list',
    module: 'model-audit',
  },

  // ---- Environnements -----------------------------------------------------
  {
    id: 'resource-mappings',
    label: 'Mappings env',
    path: '/resource-mappings',
    reach: 'url',
    kind: 'list',
    module: 'env-switcher',
  },
  {
    id: 'resource-mappings-create',
    label: 'Nouveau mapping env',
    path: '/resource-mappings/create',
    reach: 'url',
    kind: 'form',
    module: 'env-switcher',
  },
  {
    id: 'resources',
    label: 'Ressources externes',
    path: '/resources',
    reach: 'url',
    kind: 'list',
    module: 'dep-graph',
  },
  // `/tables` et `/dep-graph` ne sont plus des écrans : ce sont des redirections
  // vers `/resources`, gardées pour que les favoris posés avant le renommage
  // continuent de marcher. Les parcourir mesurerait `/resources` deux fois.

  // ---- Paramètres ---------------------------------------------------------
  { id: 'instances', label: 'Instances', path: '/instances', reach: 'url', kind: 'list' },
  {
    id: 'instances-create',
    label: 'Nouvelle instance n8n',
    path: '/instances/create',
    reach: 'url',
    kind: 'form',
  },
  { id: 'clients', label: 'Clients', path: '/clients', reach: 'url', kind: 'list' },
  { id: 'workflow-groups', label: 'Groupes', path: '/workflow-groups', reach: 'url', kind: 'list' },
  {
    id: 'workflow-groups-create',
    label: 'Nouveau groupe',
    path: '/workflow-groups/create',
    reach: 'url',
    kind: 'form',
  },
  { id: 'finding-ignores', label: 'Findings ignorés', path: '/finding-ignores', reach: 'url', kind: 'list' },
  {
    id: 'assistant-lessons',
    label: 'Leçons IA',
    path: '/assistant-lessons',
    reach: 'url',
    kind: 'list',
    module: 'assistant-learning',
  },
  {
    id: 'notification-channels',
    label: 'Alertes',
    path: '/notification-channels',
    reach: 'url',
    kind: 'list',
    module: 'notifier',
  },
  {
    id: 'export-targets',
    label: 'Cibles export',
    path: '/export-targets',
    reach: 'url',
    kind: 'list',
    module: 'versioning',
  },
  {
    id: 'export-targets-create',
    label: "Nouvelle cible d'export",
    path: '/export-targets/create',
    reach: 'url',
    kind: 'form',
    module: 'versioning',
  },
  { id: 'modules', label: 'Modules', path: '/modules', reach: 'url', kind: 'list' },
  { id: 'app-logs', label: 'Logs', path: '/app-logs', reach: 'url', kind: 'list', module: 'app-logs' },
  {
    id: 'config-transfer',
    label: 'Export / Import',
    path: '/config-transfer',
    reach: 'url',
    kind: 'form',
    module: 'config-transfer',
  },

  // ---- Écrans de détail : l'id vient d'un enregistrement réel -------------
  {
    id: 'workflow-show',
    label: "Page d'un workflow",
    reach: 'record',
    kind: 'detail',
    from: '/workflows',
    link: 'a[href^="/workflows/show/"]',
  },
  {
    id: 'workflow-view',
    label: "Vue d'un workflow (schéma)",
    reach: 'record',
    kind: 'detail',
    from: '/workflows',
    link: 'a[href^="/workflows/show/"]',
    rewrite: (href) => href.replace('/workflows/show/', '/workflows/view/'),
  },
  {
    id: 'instance-show',
    label: "Page d'une instance",
    reach: 'record',
    kind: 'detail',
    from: '/instances',
    link: 'a[href^="/instances/show/"]',
  },
];

/** Les écrans du menu : ceux dont on vérifie qu'un clic dans la nav les atteint. */
export const MENU_PATHS = SCREENS.filter(
  (s) => s.reach === 'url' && s.kind !== 'form' && s.path !== '/login',
).map((s) => s.path);
