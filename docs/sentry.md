# Remontée des erreurs — Sentry ou GlitchTip

La plateforme envoie ses erreurs à un serveur qui parle le protocole Sentry.
Deux hôtes possibles, **le même code et le même réglage** : Sentry (SaaS ou
auto-hébergé) ou **[GlitchTip](https://glitchtip.com/)**, réimplémentation libre
du même protocole d'ingestion, largement plus légère à héberger. Le SDK ne sait
pas lequel est en face : c'est le DSN qui décide.

Rien n'est initialisé sans DSN — la plateforme doit tourner entière sans service
externe, et un SDK initialisé à vide met en file des événements que personne ne
relèvera.

## Ce que ça ajoute au journal des erreurs déjà présent

La plateforme a déjà deux endroits où une panne se voit, et ils ne répondent pas
à la même question :

| | ce qu'on y voit | portée |
|---|---|---|
| `/app-logs` (module `app-logs`) | les lignes de log de l'API | le process courant, 2 000 lignes, perdues au redémarrage |
| `/errors` (module `monitoring`) | les exécutions n8n en erreur | les workflows surveillés, pas la plateforme |
| Sentry / GlitchTip | les plantages de la plateforme elle-même | tous les process, historisé, groupé, alerté |

Autrement dit : `/errors` surveille ce que la plateforme observe, Sentry
surveille la plateforme. Un 500 de l'API dans le conteneur d'hier n'existe plus
nulle part sans lui.

## Mise en place

1. Créer un projet dans Sentry ou GlitchTip (dans GlitchTip : `Projects` →
   `Create Project`, plateforme **Node.js** pour l'API, **Next.js** pour le front —
   ces choix ne changent que la doc affichée, jamais l'ingestion).
2. Copier le DSN de chaque projet dans `.env` :

```bash
# API (serveur) — ne sort jamais du conteneur
SENTRY_DSN=https://<clé>@glitchtip.mondomaine.tld/1
# Front — public par construction, inliné dans le bundle du navigateur
NEXT_PUBLIC_SENTRY_DSN=https://<clé>@glitchtip.mondomaine.tld/2
SENTRY_ENVIRONMENT=prod
SENTRY_RELEASE=            # ex: sha du commit déployé
```

3. Reconstruire l'image du front. `NEXT_PUBLIC_SENTRY_DSN` est **inliné au
   build** (comme `NEXT_PUBLIC_API_URL`, cf. `output: 'standalone'`) : posé au
   runtime, il n'atteindra jamais le navigateur. Les fichiers compose le passent
   déjà en build arg.

Un seul projet pour les deux fonctionne aussi ; deux séparent les erreurs
serveur des erreurs navigateur, qui ne se traitent pas de la même façon.

## Ce qui est envoyé, et ce qui ne l'est pas

- **Envoyé** : les 5xx de l'API (avec méthode, route et statut), les exceptions
  non rattrapées du process, les erreurs de rendu du front.
- **Pas envoyé** : les 4xx — un 404 ou un 409 est une réponse, pas une panne, et
  les remonter noierait les vraies pannes dans le bruit du quotidien.
- **Pas envoyé non plus** : corps de requête, cookies, adresse IP
  (`sendDefaultPii: false`). Les messages passent par `redactSecrets`, le même
  masquage que les logs affichés à l'écran : une clé API n8n ou un jeton GitHub
  se promène dans un message d'erreur aussi facilement que dans un log.
- **Query string** : jamais — les jetons de heartbeat y passent. La route est
  celle du routage (`/monitoring/beat/:token`), pas l'URL appelée.

## Différences GlitchTip à connaître

GlitchTip couvre l'ingestion d'erreurs, leur regroupement et les alertes. Il ne
stocke **ni les transactions de performance ni le rejeu de session**. D'où les
deux réglages à zéro par défaut :

- `SENTRY_TRACES_SAMPLE_RATE=0` — les monter n'a de sens que sur du Sentry ;
  ailleurs, c'est payer des appels réseau pour des données jetées. La durée des
  requêtes de la plateforme est déjà dans `/app-logs`.
- Rejeu de session désactivé en dur côté front : il enverrait le contenu des
  écrans — dont les workflows d'un client — à un tiers.

Le **téléversement des sourcemaps** (`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`,
`SENTRY_PROJECT`) reste optionnel : sans jeton, le build n'en envoie aucune et
n'échoue pas pour autant. Les piles du front sont alors minifiées ; celles de
l'API ne le sont jamais.

## Vérifier que ça marche

L'API annonce au démarrage `Sentry actif (erreurs remontées vers SENTRY_DSN)`.
Pour un événement réel, n'importe quelle route inexistante ne suffira pas (c'est
un 404) : il faut un vrai 5xx — par exemple couper Postgres et rafraîchir une
liste. L'événement doit apparaître dans le projet en quelques secondes.

## Où c'est branché

| fichier | rôle |
|---|---|
| `apps/api/src/infra/sentry/sentry.ts` | init, masquage, capture d'un 5xx, `flush` |
| `apps/api/src/infra/sentry/instrument.ts` | importé en tête de `main.ts`, avant le chargement des modules |
| `apps/api/src/common/filters/all-exceptions.filter.ts` | le point unique où passent les erreurs HTTP |
| `apps/web/sentry.{client,server,edge}.config.ts` | un runtime Next par fichier (navigateur, serveur, middleware) |
| `apps/web/instrumentation.ts` | ce que Next charge au démarrage du serveur |
| `apps/web/src/app/global-error.tsx` | dernier filet du rendu client |

Ce n'est **pas un port hexagonal** : Sentry ne rend aucun service au domaine, il
observe le process. Comme le tampon de logs, il vit dans `infra/` et se branche
avant la DI — un module métier n'a jamais à le connaître.
