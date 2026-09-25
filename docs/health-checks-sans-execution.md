# Health checks n8n sans exécution parasite

> Résultats des POC du 2026-08-05 sur deux instances n8n auto-hébergées réelles (appelées ici « instance A » et « instance B »). Tout ce qui est décrit ici a été testé en réel.

## Problème de départ

Les health checks historiques étaient des nœuds Webhook dédiés (`health-<nom-du-workflow>`…) ajoutés **dans les workflows de prod**, pingués périodiquement. Chaque ping créait une exécution du workflow client → liste d'exécutions polluée, debug pénible. L'idée initiale (taguer ces exécutions pour les filtrer) a été POCée puis abandonnée : on peut vérifier la santé **sans générer d'exécution du tout**.

## Les 4 briques de check passif (zéro exécution)

### 1. Instance vivante + DB : `/healthz` et `/healthz/readiness`

Endpoints publics, sans authentification :

```
GET https://<instance>/healthz            → {"status":"ok"}   (process n8n vivant)
GET https://<instance>/healthz/readiness  → {"status":"ok"}   (DB connectée et migrée)
```

### 2. Webhook enregistré : la sonde « mauvaise méthode » ⭐

**Le finding clé.** On appelle un webhook de prod avec une méthode HTTP qu'il n'accepte **pas** (ex. DELETE sur un webhook GET/POST). La méthode ne correspondant pas, n8n **n'exécute jamais le workflow**, mais sa réponse dit tout :

| État du webhook | Réponse n8n (404 dans les deux cas) |
|---|---|
| **Vivant** (workflow actif, webhook enregistré) | `This webhook is not registered for DELETE requests. Did you mean to make a GET request?` |
| **Mort** (workflow inactif / webhook désenregistré) | `The requested webhook "DELETE <path>" is not registered.` + hint sur l'activation |

Le discriminant fiable est la phrase **`Did you mean to make a … request?`** : elle n'apparaît que si n8n a trouvé le webhook. Analogie : « pas la bonne clé, essayez l'autre » = il y a quelqu'un derrière la porte ; « personne n'habite ici » = webhook mort.

Vérifié : l'ID de dernière exécution du workflow sondé est strictement inchangé avant/après la sonde.

**Conséquence : on sonde directement les vrais webhooks de prod.** Les nœuds Webhook `health-*` dédiés ne servent plus à rien et peuvent être supprimés des workflows clients.

### 3. Workflow censé tourner : flag `active`

```
GET /api/v1/workflows/{id}   (header X-N8N-API-KEY)
→ champ "active": true/false
```

### 4. Le workflow tourne *vraiment* : analyse des exécutions réelles

```
GET /api/v1/executions?workflowId=<id>&limit=N   (header X-N8N-API-KEY)
```

Signaux à en tirer, sans rien déclencher :
- dernière exécution en `error` ;
- workflow planifié **silencieux** depuis plus longtemps que sa période (trigger mort — indétectable par le flag `active` seul) ;
- taux d'erreur récent.

C'est le seul étage qui voit les pannes « profondes » (credential expirée, service externe HS au milieu du workflow) — via les vraies exécutions de prod. L'ancien ping health ne les voyait pas non plus : il touchait le nœud Webhook, pas les nœuds derrière.

## Répartition Kuma ↔ plateforme

**Kuma en direct** (monitors HTTP classiques, provisionnables par `kuma-provisioning`) :
- `/healthz` et `/healthz/readiness` → check HTTP 200 ;
- la sonde mauvaise-méthode → monitor HTTP avec méthode custom (ex. DELETE) + keyword attendu `Did you mean` ; un monitor par webhook de prod.

**Plateforme uniquement** (logique + clé API hors de portée de Kuma), résultat relayé en **push monitor** Kuma via le mécanisme existant du module `monitoring` :
- flag `active` des workflows ;
- analyse des exécutions (erreurs, silence anormal, taux d'erreur).

## Annexe — POC tagging d'exécutions (abandonné mais documenté)

Testé et fonctionnel, gardé pour référence si des checks actifs (exécution réelle) devaient revenir :

- **API publique** : `GET/PUT /api/v1/executions/{id}/tags` existe. Le PUT attend `[{"id": "<annotationTagId>"}]` avec des IDs de tags **déjà existants** — aucun endpoint public ne crée les tags d'annotation (création = UI n8n uniquement ; `/rest/annotation-tags` exige une session navigateur).
- **Auto-tag** : un nœud HTTP Request dans le workflow peut taguer sa propre exécution *pendant* qu'elle tourne (`PUT …/executions/{{ $execution.id }}/tags` — l'exécution existe déjà en DB à ce moment-là). Messages discriminants : `Not Found` = exécution inconnue, `Some tags not found` = tag inconnu.
- **customData** (plan B validé de bout en bout) : `$execution.customData.set('healthcheck','true')` dans un nœud Code, relu via `GET /api/v1/executions/{id}?includeData=true`. Limites : strings only, clé ≤ 50 car., valeur ≤ 255, 10 entrées max.
- **Licence** : l'UI d'annotation n'apparaît que sur une instance licenciée — l'enregistrement **gratuit** de la Community edition suffit (Settings → Usage and plan → Unlock). Au 2026-08-05, l'instance A n'était pas enregistrée, l'instance B oui.
- Mystère non résolu : un tag posé via l'UI sur l'instance B ressortait `[]` via `GET /executions/{id}/tags`.
