const path = require('path');
const { withSentryConfig } = require('@sentry/nextjs');

// Identifiant de build, injecté dans le client pour versionner le cache du
// service worker. Sans lui, un navigateur qui a installé la console garde les
// assets du déploiement précédent : les caches ne sont purgés qu'au changement
// de nom, et un nom figé ne change jamais.
const buildId = process.env.BUILD_ID || String(Date.now());

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Permet plusieurs serveurs dev en parallèle (ex: sessions Claude) sans corrompre le build.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Image de prod autonome : `next build` produit un serveur + uniquement les
  // fichiers tracés comme nécessaires, au lieu des node_modules du monorepo.
  // Contrepartie : la config (dont les rewrites ci-dessous) est figée au build,
  // API_INTERNAL_URL doit donc être fourni comme build arg, pas au runtime.
  output: 'standalone',
  reactStrictMode: true,
  // Parcours e2e seulement : `next dev` oublie une page restée une minute sans visite (5 gardées
  // au plus) et la recompile à la suivante — 45 s pour /workflows sur un runner de CI, soit un
  // test perdu. Hors e2e, le défaut reste : garder toutes les pages coûterait la mémoire du dev.
  ...(process.env.NEXT_KEEP_COMPILED_PAGES && {
    onDemandEntries: { maxInactiveAge: 60 * 60 * 1000, pagesBufferLength: 100 },
  }),
  // Inliné dans le bundle client au build (cf. buildId ci-dessus).
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  transpilePackages: [
    '@refinedev/antd',
    'antd',
    '@ant-design/icons',
    'rc-util',
    'rc-pagination',
    'rc-picker',
  ],
  // Proxy interne vers l'API : le navigateur ne parle qu'à l'origine du front
  // (pas de CORS, pas de localhost:3001 en dur). En Docker, l'API est jointe
  // via le réseau interne (http://api:3001).
  async rewrites() {
    const apiInternalUrl = process.env.API_INTERNAL_URL || 'http://localhost:3001';
    return [{ source: '/backend/:path*', destination: `${apiInternalUrl}/:path*` }];
  },
  experimental: {
    // Next 14 : sans ce drapeau, `instrumentation.ts` n'est jamais chargé, donc
    // Sentry ne s'initialise ni côté serveur ni côté middleware.
    instrumentationHook: true,
    // Le tracing de `output: standalone` doit partir de la racine du monorepo
    // (node_modules hoistés). Option encore sous `experimental` en Next 14.
    outputFileTracingRoot: path.join(__dirname, '../../'),
    // Le proxy de rewrite coupe la socket au bout de 30 s par défaut : les
    // traitements longs (revue IA d'un workflow, export global, nettoyage des
    // doublons) recevaient un 500 « socket hang up » alors que l'API allait au
    // bout. Aligné sur `requestTimeout` de l'API (apps/api/src/main.ts).
    proxyTimeout: 30 * 60 * 1000,
  },
};

// Remontée des erreurs du front (Sentry ou GlitchTip, cf. docs/sentry.md).
// L'enveloppe reste posée même sans DSN : elle ne fait alors rien de plus qu'un
// build ordinaire, et la retirer conditionnellement ferait diverger le build de
// dev de celui de prod.
module.exports = withSentryConfig(nextConfig, {
  // Pas de télémétrie vers Sentry, et pas de bannière à chaque compilation.
  telemetry: false,
  silent: true,
  // Les sourcemaps ne partent que si on a de quoi les téléverser : sur une
  // instance GlitchTip auto-hébergée sans jeton, le build échouerait pour rien.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  authToken: process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Réservé à l'hébergement Vercel, que la plateforme n'utilise pas.
  automaticVercelMonitors: false,
});
