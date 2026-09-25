# Authentification

La console est réservée à l'équipe. Deux méthodes de connexion, activables
indépendamment par variables d'environnement :

| Méthode | Variables | Usage |
|---|---|---|
| Google OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ALLOWED_DOMAIN` | méthode principale |
| Identifiant / mot de passe | `APP_USERNAME` (défaut `admin`), `APP_PASSWORD` | repli, dépannage, dev |

**Tant qu'aucune des deux n'est configurée, la plateforme reste ouverte** —
c'est le comportement historique, pratique en local. Dès que `APP_PASSWORD` ou
le couple `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` est posé, tout est protégé
(pages et appels API).

## Ce qui est protégé, et par quoi

```
navigateur ──► middleware Next ──► pages          (pas de session → /login)
                    │
                    └───────────► /backend/*  ──► API  (401 JSON si pas de session)
                                  + x-api-token
n8n ─────────────────────────────────────────────► API  POST /monitoring/beat/:token
```

- `apps/web/src/middleware.ts` : garde unique du front. Le navigateur ne parlant
  qu'à l'origine du front (proxy `/backend`, cf. `next.config.js`), tout ce qui
  atteint l'API passe d'abord par là.
- `apps/api/src/common/auth/api-token.guard.ts` : l'API peut avoir son propre
  domaine public (requis si n8n est à l'extérieur et poste ses heartbeats).
  Sans ce garde, ce domaine offrirait toute la plateforme en accès anonyme.
  Le jeton `API_ACCESS_TOKEN` est injecté par le proxy Next : il reste
  serveur-à-serveur, le navigateur ne le voit jamais.
  Les routes appelées par des tiers portent `@PublicRoute()` — aujourd'hui le
  seul heartbeat `POST /monitoring/beat/:token`, protégé par son propre secret.

Conséquence : dès que `API_ACCESS_TOKEN` est posé, **laisser
`NEXT_PUBLIC_API_URL` vide**. En pointant l'API en direct, le navigateur
appellerait sans jeton et recevrait des 401.

## Session

Cookie `nwm_session`, signé HMAC-SHA256 (`SESSION_SECRET`, à défaut
`APP_PASSWORD` puis `GOOGLE_CLIENT_SECRET`), `httpOnly` + `sameSite=lax`,
`secure` en HTTPS. Il porte l'identité (email, nom, méthode) et sa date
d'expiration **dans le payload signé** — le `maxAge` du cookie est côté client,
donc falsifiable, la date signée ne l'est pas. Durée : 7 jours.

Changer `SESSION_SECRET` déconnecte tout le monde.

## Mettre en place Google OAuth

1. Google Cloud Console → **APIs & Services → Credentials → Create credentials →
   OAuth client ID**, type **Web application**.
2. **Authorized redirect URIs** : `<APP_BASE_URL>/auth/google/callback`
   (ex. `https://n8nops.mondomaine.tld/auth/google/callback`). En local :
   `http://localhost:3000/auth/google/callback`.
3. Écran de consentement : **Internal** (l'organisation Workspace suffit à
   cadrer les comptes ; le filtre de domaine reste appliqué côté serveur).
4. Renseigner `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_BASE_URL`, et
   `GOOGLE_ALLOWED_DOMAIN` avec le ou les domaines Workspace autorisés (CSV
   accepté). **Sans cette variable, la connexion Google refuse tout le monde.**

`APP_BASE_URL` est **indispensable derrière un reverse proxy** : sans
elle, la requête porte l'adresse interne du conteneur, inutilisable comme
`redirect_uri`.

Le contrôle d'accès est fait sur l'ID token récupéré en direct chez Google
(TLS serveur-à-serveur) : `aud`, `iss`, `exp`, `email_verified`, puis le claim
`hd` **et** le suffixe de l'email. Un compte Gmail personnel n'a pas de `hd` :
il est refusé même s'il porte une adresse du domaine.

## Dépannage

| Symptôme | Cause probable |
|---|---|
| Boucle de redirection vers `/login` après un login Google réussi | `SESSION_SECRET` différent entre deux instances/redémarrages |
| `Ce compte Google n'appartient pas au domaine autorisé` | compte hors Workspace, ou `GOOGLE_ALLOWED_DOMAIN` mal renseigné |
| `redirect_uri_mismatch` côté Google | `APP_BASE_URL` ≠ URI déclarée dans le client OAuth |
| Toutes les listes en 401 après connexion | `NEXT_PUBLIC_API_URL` renseigné alors que `API_ACCESS_TOKEN` est posé |
| Heartbeats n8n en échec (401) | `@PublicRoute()` retiré du endpoint `beat`, ou n8n qui tape une autre route |
