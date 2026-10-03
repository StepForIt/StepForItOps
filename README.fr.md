<div align="center">

<img src="apps/web/public/icons/icon-192.png" alt="StepForIt Ops" width="88" />

# StepForIt Ops

**La tour de contrôle de vos workflows n8n.**
Versionnez, vérifiez, promouvez de la dev à la prod et surveillez tout votre parc depuis une seule console. Vos instances restent intactes.

[![Licence](https://img.shields.io/badge/licence-BSL%201.1-04B2AD)](LICENSE.md)
[![Docker](https://img.shields.io/docker/pulls/mathieum/stepforitops-api?label=docker%20pulls&color=00458C)](https://hub.docker.com/r/mathieum/stepforitops-api)
![n8n](https://img.shields.io/badge/n8n-multi--instances-FF6D5A)
![Make](https://img.shields.io/badge/Make-supporté-6D00CC)
![Langues](https://img.shields.io/badge/UI-FR%20%7C%20EN-F5B301)

**Français** · 🇬🇧 [Read in English](README.md)

[Démarrer en 2 minutes](#-démarrer-en-2-minutes) · [Fonctionnalités](#-ce-que-vous-gagnez) · [Mode démo](#-voir-sans-rien-brancher) · [Déployer](#-déploiement)

<img src="docs/assets/readme/dashboard.fr.png" alt="Tableau de bord StepForIt Ops" width="900" />

</div>

---

## 💡 Pourquoi

n8n est génial pour **construire**. Dès que vous avez 30 workflows, 3 environnements et des clients, il devient difficile à **exploiter** :

| Sans StepForIt Ops | Avec StepForIt Ops |
|---|---|
| 😬 Une modif en prod, aucun historique | 🗂️ Chaque version sauvegardée, exportée sur GitHub / Drive, restaurable en un clic |
| 🙈 On copie-colle le JSON de dev vers prod en croisant les doigts | 🚀 Promotion dev → preprod → prod avec **diff lisible**, contrôles bloquants et version posée |
| 🔕 L'erreur est découverte par le client | 🔔 Erreurs regroupées en problèmes, alertes Slack, rechutes détectées |
| 💸 La facture IA arrive en fin de mois | 📊 Coût de chaque appel LLM, par workflow et par jour, budget avec alerte |
| 🐛 Un nœud mal configuré passe inaperçu | ✅ Contrôles automatiques : références cassées, secrets en clair, champs mal orthographiés |

---

## ✨ Ce que vous gagnez

<table>
<tr>
<td width="50%" valign="top">

### 🚀 Promouvoir sans peur
Voyez **ce qui change** en français, pas en JSON : « nouveau nœud Slack », « Par client alimente désormais Résumé ». Ressources, credentials et sous-workflows sont rebranchés automatiquement vers la prod.

</td>
<td width="50%"><img src="docs/assets/readme/divergence.fr.png" alt="Écart avec la prod" /></td>
</tr>
<tr>
<td><img src="docs/assets/readme/findings.fr.png" alt="Contrôles qualité" /></td>
<td valign="top">

### ✅ Attraper les bugs avant la prod
Plus de 60 contrôles : références de nœuds cassées, HTTP sans retry, secrets en clair, champs mal orthographiés, boucles mal câblées, colonnes manquantes dans Airtable ou Sheets. Plus une **revue IA** de la logique.

</td>
</tr>
<tr>
<td valign="top">

### 🔔 Savoir avant le client
Les erreurs sont **regroupées en problèmes** (une alerte, pas cinquante), classées (auth, quota, réseau…), et un problème « déjà corrigé » qui revient est signalé. **Zéro exécution générée** sur vos instances.

</td>
<td><img src="docs/assets/readme/errors.fr.png" alt="Erreurs regroupées" /></td>
</tr>
<tr>
<td><img src="docs/assets/readme/llm-costs.fr.png" alt="Coûts IA" /></td>
<td valign="top">

### 💸 Maîtriser la facture IA
Tokens et coût de chaque nœud LLM, lus dans les exécutions **sans proxy ni modification de vos workflows**. Par workflow, modèle et jour, avec budget quotidien et audit des modèles surdimensionnés.

</td>
</tr>
<tr>
<td valign="top">

### 🤖 Un assistant qui connaît vos workflows
Demandez « ajoute un retry sur l'appel Stripe » : l'assistant propose une modification, la vérifie, et vous la montre **en diff avant tout envoi** vers n8n. Retour arrière toujours possible.

</td>
<td><img src="docs/assets/readme/workflow.fr.png" alt="Fiche d'un workflow" /></td>
</tr>
</table>

### Et aussi

- 🗺️ **Cartographie** : qui appelle qui, et quels workflows touchent cette table Airtable avant de la modifier.
- ⏱️ **Performance** : durées P50/P95, alerte quand un workflow ralentit.
- 🧪 **Tests** : cas enregistrés depuis de vraies exécutions, essai d'un nœud seul, bouchonnage de ce qui envoie des mails.
- ⏳ **ROI** : temps gagné estimé par workflow et par client, prêt à montrer.
- 🔒 **Verrou** d'un workflow critique, procédures de mise en ligne rejouables, Uptime Kuma, Slack.
- 🧩 **Modulaire** : chaque fonction se désactive d'un clic. 🌍 Console FR / EN, installable sur mobile.

---

## ⚡ Démarrer en 2 minutes

```bash
curl -O https://raw.githubusercontent.com/StepForIt/StepForItOps/dev/docker-compose.hub.yml
# poser POSTGRES_PASSWORD, API_PUBLIC_URL, API_ACCESS_TOKEN, APP_BASE_URL dans un .env (cf. .env.example)
docker compose -f docker-compose.hub.yml up -d
```

Ouvrez la console, créez le compte admin, **ajoutez l'URL et la clé API de vos instances n8n**. Synchro, contrôles, surveillance et coûts démarrent tout seuls.

## 👀 Voir sans rien brancher

Le **mode démo** lance la vraie console sur un parc fictif (2 clients, 17 workflows, 45 jours d'historique), sans n8n ni clé IA :

```bash
DATABASE_URL=postgresql://nwm:nwm@localhost:55444/nwm_demo pnpm --filter @nwm/demo stack
# → http://localhost:3020  (demo / demo-promo)
```

Détails : [apps/demo/README.md](apps/demo/README.md).

---

## 🛡️ Sécurité

Fermée par défaut : la première ouverture impose la création du compte admin, et les secrets stockés (clés n8n, tokens GitHub/Drive, clé IA) **ne sont jamais renvoyés à l'interface**. Sur un serveur, posez :

| Variable | Rôle | Sans elle |
|---|---|---|
| `API_ACCESS_TOKEN` | Jeton front → API (injecté par le proxy Next, jamais vu du navigateur) | L'API accepte les appels anonymes si son port est joignable |
| `GOOGLE_CLIENT_ID`/`SECRET` + `GOOGLE_ALLOWED_DOMAIN` | Connexion Google en plus du compte admin (optionnel) | Seul l'identifiant/mot de passe créé au setup fonctionne |
| `SESSION_SECRET` | Remplace le secret de session auto-généré (optionnel) | Le secret auto-généré en base fait le travail |
| `SECRETS_KEY` | Chiffre au repos, hors de la base, les clés API et comptes n8n des instances (`openssl rand -base64 32`) | Ils sont stockés en clair, et la console le signale |

<details>
<summary>À savoir aussi</summary>

- `AUTH_OPTIONAL=1` ouvre la console sans login : **dev local uniquement**.
- `GOOGLE_ALLOWED_DOMAIN` est obligatoire pour Google : sans lui, tout le monde est refusé.
- L'export de configuration et la sauvegarde complète ne sortent les secrets que scellés par une **clé d'export** redemandée à l'import ([docs/chiffrement-secrets.md](docs/chiffrement-secrets.md)) ; fermés par défaut, ouverts avec `CONFIG_EXPORT_ENABLED=1` (cf. `docker-compose.export.yml`).
- La plateforme appelle les URLs que vous configurez (n8n, Kuma, NocoDB) : ne donnez l'accès à sa configuration qu'à des personnes de confiance.
- Le compte propriétaire n8n d'une instance est demandé à chaque enregistrement tant qu'il manque, jamais imposé : [docs/acces-complet-instances.md](docs/acces-complet-instances.md).
- Détails : [docs/authentification.md](docs/authentification.md) · remontée d'erreurs Sentry / GlitchTip : [docs/sentry.md](docs/sentry.md).

</details>

## 🚢 Déploiement

<details>
<summary>Images Docker Hub, tags et build maison</summary>

Images publiées à chaque release : `mathieum/stepforitops-api` (sert aussi le conteneur `migrate`) et `mathieum/stepforitops-web`, en `linux/amd64` et `linux/arm64`.

Tags : `latest`, `0.2` et `0.2.0` sont multi-arch ; chacun existe aussi en mono-arch (`0.2.0-amd64`, `0.2.0-arm64`). `NWM_VERSION` choisit le tag.

Figé au build des images publiques : le web joint l'API à `http://stepforit-ops-api:3001` (garder cet alias réseau sur l'API, comme dans `docker-compose.hub.yml`), et Sentry côté navigateur est éteint. Pour changer ça, construire soi-même : `docker compose -f docker-compose.yml up -d` (aucun port publié, un conteneur `migrate` joue les migrations avant l'API, variables sensibles requises).

</details>

<details>
<summary>Développer (stack, commandes, tests)</summary>

TypeScript strict. API **NestJS** + **Prisma** + PostgreSQL (`apps/api`), console **Next.js** + Refine + Ant Design (`apps/web`), monorepo **pnpm**, architecture hexagonale (`packages/core` pur, `packages/adapters/*`).

```bash
cp .env.example .env
pnpm install
docker compose up -d      # postgres + api (3001) + web (3000), hot reload
```

```bash
pnpm test                                   # domaine + services d'api
pnpm lint && pnpm format                    # ESLint (0 avertissement) + Prettier
pnpm --filter @nwm/api prisma:migrate       # créer une migration
pnpm --filter @nwm/api prisma:check         # migrations ↔ schéma
pnpm --filter @nwm/web test:e2e             # parcours navigateur (Playwright)
```

Les tests d'api et e2e exigent une base jetable (nom en `_test`) :

```bash
docker run -d --name nwm-test-pg -e POSTGRES_USER=nwm -e POSTGRES_PASSWORD=nwm \
  -e POSTGRES_DB=nwm_test -p 55444:5432 postgres:16-alpine
export DATABASE_URL_TEST=postgresql://nwm:nwm@localhost:55444/nwm_test
```

Chaque PR passe 4 jobs CI : typecheck · tests · build, migrations · schéma, image api · démarrage à blanc, parcours navigateur. Fonctionnement interne : [ARCHITECTURE.md](ARCHITECTURE.md), [CLAUDE.md](CLAUDE.md). Contribuer : [CONTRIBUTING.md](CONTRIBUTING.md).

</details>

---

## 📜 Licence

**Source-available** ([Business Source License 1.1](LICENSE.md)), qui devient **AGPL-3.0 le 30 août 2030**.

- ✅ **Autorisé**, même commercialement : l'installer chez vous, la modifier, piloter vos instances n8n **ou celles de vos clients**.
- ❌ **Interdit** : en faire une offre hébergée / SaaS dont la valeur est l'accès à la plateforme elle-même.

Le nom « StepForIt Ops » et le logo ne sont pas couverts. Offre hébergée, revente : mathieu@stepforit.fr.

<div align="center">
<sub>Fait avec ❤️ par <a href="https://stepforit.fr">Step For It</a></sub>
</div>
