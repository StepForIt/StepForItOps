# StepForIt Ops

Plateforme de gestion, versioning, vérification et monitoring de workflows **n8n**, multi-instances. Elle se branche sur vos instances n8n existantes via leur API publique et n'exécute jamais rien dans vos workflows sans vous le dire.

## Ce qu'elle fait

- **Versioning** — snapshot des workflows en base + export GitHub / Google Drive, avec suivi des renommages (pas de doublons de fichiers).
- **Vérification** — analyse structurelle (références de nœuds, expressions, orphelins), checks de fiabilité (HTTP sans retry/timeout, erreurs avalées, secrets en clair), analyse des nœuds Code, confrontation des expressions au schéma réel sorti par chaque nœud (typos de champs), revue logique par IA.
- **Monitoring** — heartbeats, checks actifs, surveillance passive des exécutions en erreur (`error-watch`, zéro exécution générée), relais vers Uptime Kuma, historisation et **regroupement des erreurs en problèmes** (signature + catégorie, réouverture automatique en cas de rechute).
- **Cartographie** — carte des dépendances entre workflows (Execute Workflow, webhooks, outils IA) et vue « Ressources externes » : qui utilise cette table Airtable/NocoDB/Sheets, qu'est-ce qu'un changement de colonne impose de rouvrir.
- **Performance & coûts** — historisation des durées et statuts d'exécution (P50/P95, dérive de durée avec alerte), et **coûts IA** : tokens des nœuds LLM extraits des exécutions — sans proxy ni instrumentation des workflows — valorisés en dollars par workflow, exécution, modèle et jour, avec table de tarifs éditable et alerte de budget quotidien.
- **Outillage** — bascule dev/preprod/prod des ressources, tests de workflows (cas enregistrés + quality gates de promotion), plan de rangement, documentation Mermaid + résumé IA, chat IA sur un workflow avec édition revue en diff avant tout envoi vers n8n, alertes Slack/webhook, dashboard par client.

Chaque fonctionnalité est un module désactivable depuis l'UI.

## Stack

TypeScript strict partout. API **NestJS** + **Prisma** + PostgreSQL (`apps/api`), front **Next.js** + Refine + Ant Design (`apps/web`), monorepo **pnpm** avec un domaine pur (`packages/core`) et des adapters par système externe (`packages/adapters/*`) — architecture hexagonale.

## Démarrage rapide (dev local)

```bash
cp .env.example .env      # valeurs de dev prêtes à l'emploi
pnpm install
docker compose up -d      # postgres + api (3001) + web (3000), hot reload
```

Ouvrir <http://localhost:3000>. À la première ouverture, la plateforme demande de **créer le compte administrateur** (`/setup`) : une installation vierge n'est jamais ouverte. Pour travailler sans mur de login en dev local, poser `AUTH_OPTIONAL=1` (jamais en prod).

Ensuite : page **Instances n8n** → ajouter l'URL et la clé API de chaque instance, et tout le reste (sync des workflows, monitoring, coûts) démarre tout seul.

Commandes utiles :

```bash
pnpm test                                   # tests (domaine + services d'api)
pnpm lint                                   # ESLint (0 avertissement toléré)
pnpm format                                 # Prettier
pnpm --filter @nwm/api prisma:migrate       # créer une migration
pnpm --filter @nwm/api prisma:check         # vérifier migrations ↔ schéma
```

## Qualité

Chaque pull request passe **quatre jobs** (`.github/workflows/ci.yml`, ~4 min), et chacun attrape quelque chose qu'aucun autre ne voit :

| job | ce qu'il tient |
|---|---|
| `typecheck · tests · build` | format, lint, `tsc --noEmit` sur tout le workspace, plus de 800 tests, et les deux builds |
| `migrations · schéma` | une modification de `schema.prisma` partie **sans sa migration** : en dev le `db push` l'applique en silence, et rien ne serait rouge avant le déploiement |
| `image api · démarrage à blanc` | une dépendance importée mais **non déclarée** : elle compile, passe le typecheck, et meurt au démarrage de l'arbre `--prod` |
| `parcours · navigateur` | onze parcours dans un vrai navigateur |

Les tests vivent à trois niveaux, chacun payant son prix :

- **Domaine pur** (`packages/core`) — l'essentiel du corpus, sans la moindre IO, joué en trois secondes. C'est là que vivent les règles : atteignabilité d'une expression, signature d'une erreur, chaîne d'environnements, calcul de version.
- **Services d'api** — instanciés à la main (l'hexagonal les rend joignables sans conteneur Nest) contre une **vraie base** postgres jetable, les systèmes externes remplacés par des doublures. Ce qu'on y vérifie est précisément ce qu'ils persistent.
- **Bout en bout** — l'application Nest entière interrogée en HTTP (gardes, filtres d'exception, pagination), puis la console dans un navigateur avec un faux n8n et un faux fournisseur d'IA : personne ne paie d'appel facturé pour faire tourner la CI.

Les deux derniers ont besoin d'une base jetable, qu'ils refusent de confondre avec celle de dev :

```bash
docker run -d --name nwm-test-pg -e POSTGRES_USER=nwm -e POSTGRES_PASSWORD=nwm \
  -e POSTGRES_DB=nwm_test -p 55444:5432 postgres:16-alpine
export DATABASE_URL_TEST=postgresql://nwm:nwm@localhost:55444/nwm_test

pnpm test                                   # domaine + services d'api
pnpm --filter @nwm/web exec playwright install chromium   # une fois
pnpm --filter @nwm/web test:e2e             # parcours navigateur (Playwright)
```

Playwright démarre lui-même l'api, la console et ses doublures : il n'y a rien à lancer à côté.

## ⚠️ Sécurité — à lire avant tout déploiement

Le front est **fermé par défaut** : la première ouverture force la création du compte admin (`/setup`), et le secret de session est **généré et stocké automatiquement** (jamais écrasé ensuite). Le mode ouvert n'existe qu'en posant explicitement `AUTH_OPTIONAL=1` (dev local uniquement). Sur un serveur, à compléter :

| Variable | Rôle | Sans elle |
|---|---|---|
| `API_ACCESS_TOKEN` | Jeton front → API (injecté par le proxy Next, jamais vu du navigateur) | L'API accepte les appels anonymes si son port est joignable |
| `GOOGLE_CLIENT_ID`/`SECRET` + `GOOGLE_ALLOWED_DOMAIN` | Connexion Google en plus du compte admin (optionnel) | Seul l'identifiant/mot de passe créé au setup fonctionne |
| `SESSION_SECRET` | Remplace le secret de session auto-généré (optionnel, `openssl rand -hex 32`) | Le secret auto-généré en base fait le travail |

La console affiche une bannière d'avertissement tant que l'une manque, et l'API le signale dans ses logs au démarrage. La plateforme stocke les clés API de vos instances n8n : traitez-la comme un coffre.

À savoir aussi :

- `GOOGLE_ALLOWED_DOMAIN` est **obligatoire** pour la connexion Google : sans lui, elle refuse tout le monde (fail closed).
- L'export de configuration (`config-transfer`) sort tous les secrets en clair : il est **fermé par défaut** et ne s'ouvre qu'avec `CONFIG_EXPORT_ENABLED=1` (posé uniquement par l'override de dev, jamais en prod).
- Les secrets stockés (clés API n8n, tokens GitHub/Drive, mot de passe Kuma, clé Anthropic) ne sont **jamais renvoyés à l'UI** — elle ne voit que « un secret existe ».
- Par nature, la plateforme émet des requêtes vers les URLs que vous configurez (instances n8n, Kuma, NocoDB). Ne donnez l'accès à sa configuration qu'à des personnes de confiance : c'est un levier SSRF assumé.

Mise en place détaillée de l'authentification : [docs/authentification.md](docs/authentification.md).

Remontée des erreurs de la plateforme (Sentry ou GlitchTip, optionnelle et
désactivée sans DSN) : [docs/sentry.md](docs/sentry.md).

## Déploiement (prod)

`docker compose -f docker-compose.yml up -d` (sans l'override de dev) : images de prod optimisées, aucun port publié (un reverse proxy route vers `web:3000`, et `api:3001` au besoin), un conteneur `migrate` joue les migrations Prisma **avant** le démarrage de l'API (qui ne touche jamais au schéma), toutes les variables sensibles sont requises (`${VAR:?}`). Le détail du fonctionnement interne est documenté dans [CLAUDE.md](CLAUDE.md) et [ARCHITECTURE.md](ARCHITECTURE.md).

## Licence

**Source-available**, pas open source au sens OSI : le code est lisible, modifiable et redistribuable, mais son usage porte une limite.

[Business Source License 1.1](LICENSE.md) — en clair :

- **Autorisé**, y compris commercialement : installer la plateforme chez vous, la modifier, et l'utiliser pour piloter vos instances n8n **ou celles de vos clients**, ces clients pouvant avoir accès à votre installation en accessoire de vos prestations.
- **Interdit** : en faire une offre hébergée, managée ou multi-tenant dont la valeur pour le tiers est l'accès à la plateforme elle-même — modifiée, renommée ou recombinée n'y change rien.
- **Le 30 août 2030**, cette version bascule automatiquement en [AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html). La restriction est temporaire ; le passage en licence libre ne l'est pas.

Le nom « StepForIt Ops » et le logo ne sont pas couverts par cette licence.

Pour un usage hors de ce cadre — offre hébergée, revente : mathieu@stepforit.fr.

Contribuer : voir [CONTRIBUTING.md](CONTRIBUTING.md).
