# Conception — monitor `error-watch`

> Remplace le workflow n8n « Monitoring - Error Check » (poll toutes les 2 min de `/api/v1/executions?status=error` + push Kuma) par un check porté par la plateforme : zéro exécution n8n, clé API jamais exposée, meilleure qualité de signal. Contexte : [health-checks-sans-execution.md](./health-checks-sans-execution.md).

## Principe

Un monitor de `kind: "error-watch"`, **un par instance n8n**, qui à intervalle régulier :

1. interroge l'API publique de l'instance : `GET /api/v1/executions?status=error&limit=N` ;
2. ne retient que les erreurs **nouvelles depuis le dernier passage** (curseur sur l'ID d'exécution, pas de fenêtre glissante) ;
3. pushe `up`/`down` vers la sonde push Uptime Kuma existante, avec un message lisible (noms de workflows résolus depuis la DB plateforme) ;
4. si l'API n8n est injoignable → push `down` explicite « API n8n injoignable : … » (mieux que le silence du workflow actuel).

### Pourquoi un curseur plutôt qu'une fenêtre de 10 min (comme le workflow actuel)

- La fenêtre re-signale les mêmes erreurs pendant 5 ticks, puis les oublie même si rien n'est corrigé — le curseur signale chaque erreur exactement une fois.
- `limit=10` + rafale d'erreurs = erreurs ratées ; avec un curseur on pagine jusqu'au dernier ID vu.
- Les IDs d'exécution n8n sont strictement croissants (numériques) → comparaison fiable (`BigInt`).
- Premier passage : on **baseline** (on mémorise l'ID max sans alerter) pour ne pas re-signaler tout l'historique d'erreurs.

## Modèle de données

Pas de nouvelle table. Évolutions du modèle `Monitor` (Prisma) :

```prisma
model Monitor {
  ...
  kind  String // heartbeat | active | error-watch   ← nouveau kind (commentaire à jour)
  // error-watch : { instanceId, intervalSeconds?, limit? }
  config Json?
  state  Json?  // ← NOUVELLE colonne : état runtime (error-watch : { lastSeenExecutionId })
}
```

- `workflowId` reste `null` (monitor de niveau instance) ; le rattachement se fait par `config.instanceId`.
- `state` séparé de `config` : `config` = intention utilisateur (éditable UI), `state` = mémoire du service (jamais éditée à la main). Migration Prisma nécessaire (`state Json?`, additif, sans risque).

Config par défaut : `intervalSeconds: 120` (parité avec le workflow actuel), `limit: 50` par page.

## Port & adapter (hexagonal)

`packages/core/src/ports/n8n-api.port.ts` — le `listExecutions(instance, workflowId, limit)` actuel exige un workflowId ; on ajoute une méthode dédiée plutôt que d'élargir sa signature :

```ts
/** Exécutions en erreur de toute l'instance, les plus récentes d'abord. */
listErrorExecutions(
  instance: N8nInstanceConfig,
  options?: { limit?: number; cursor?: string },
): Promise<{ executions: N8nExecutionSummary[]; nextCursor?: string }>;
```

Implémentation dans `packages/adapters/n8n-api` : `GET /api/v1/executions?status=error&limit=…[&cursor=…]` (sans `includeData` — les résumés suffisent, réponse légère). Le service s'arrête de paginer dès qu'il atteint `lastSeenExecutionId`.

## Nouveau service : `error-watch.service.ts`

Un fichier = une responsabilité — même gabarit que `ActiveCheckService` :

```
@Cron(EVERY_MINUTE) tick()
  ├─ garde : registry.isEnabled('monitoring')
  ├─ monitors kind=error-watch, enabled, intervalSeconds écoulé
  └─ pour chacun : check(monitor)

check(monitor) : 'up' | 'down'
  ├─ instance ← prisma.n8nInstance(config.instanceId)   (introuvable → down « instance inconnue »)
  ├─ page listErrorExecutions jusqu'à lastSeenExecutionId (ou 1 page si baseline)
  ├─ fresh = exécutions d'ID > lastSeenExecutionId
  ├─ baseline (state vide) → mémorise l'ID max, push 'up', terminé
  ├─ fresh vide → push 'up' « OK »
  ├─ sinon → résolution des noms : prisma.workflow.findMany({ instanceId, n8nId IN … })
  │    message : « 3 nouvelles erreurs : Facturation (×2), Sync Airtable » (tronqué ~200 car.)
  │    push 'down' + event EVENTS.monitorErrorsDetected
  ├─ API injoignable → push 'down' « API n8n injoignable : <err> » (state inchangé :
  │    les erreurs survenues pendant la panne seront signalées au retour)
  └─ update lastStatus / lastCheckAt / state.lastSeenExecutionId
```

Détails qui comptent :

- **Auto-exclusion inutile** : le check ne s'exécute pas dans n8n, la rustine `workflowId !== myWorkflowId` du workflow actuel disparaît.
- **Noms de workflows** : la DB plateforme (`Workflow.n8nId` + `name`) résout les noms — l'API publique ne renvoie pas `workflowName` (le workflow actuel affichait des IDs bruts). Workflow inconnu en DB → fallback sur l'ID n8n.
- **Événement** : `EVENTS.monitorErrorsDetected` (payload typé dans `packages/core/src/events/events.ts` : `{ monitorId, instanceId, count, workflows: { n8nId, name, executionIds }[] }`) — communication inter-modules par événements uniquement ; permettra plus tard à `verifier` ou à des notifications de réagir sans couplage.
- **up systématique** quand tout va bien : Kuma déduit le « down par absence » si la plateforme meurt — la plateforme doit elle-même avoir un monitor Kuma (hors scope de ce module).

## Contrôleur & provisioning

- `POST monitors/:id/check` (existant) : dispatcher selon `kind` — `active` → `ActiveCheckService`, `error-watch` → `ErrorWatchService` (actuellement câblé en dur sur active).
- CRUD existant : rien à changer, `MonitorInput` accepte déjà `kind`/`config` libres.
- `KumaProvisioningService.provisionInstance` : en plus des heartbeats par workflow, créer (si absent) le monitor `error-watch` de l'instance + sa sonde push Kuma (nom : `errors — <nom instance>`).
- Rattachement à une sonde Kuma existante : le flux `kuma-import` actuel importe la sonde en monitor local → il suffit ensuite de passer son `kind` à `error-watch` et de remplir `config.instanceId` (PATCH standard) — c'est le chemin de migration pour conserver une sonde push historique.

## UI (page Monitors, Refine)

- Badge de `kind` : ajouter `error-watch`.
- Formulaire : si `kind = error-watch` → select d'instance (resource existante), `intervalSeconds`.
- Colonne existante lastStatus/lastCheckAt : inchangée. Bouton « check now » : inchangé (le dispatch se fait côté API).

## Plan de migration (sans coupure Kuma)

1. Déployer le kind `error-watch` (migration Prisma incluse).
2. Pour une instance déjà surveillée : `kuma-import` de la sonde push existante → PATCH kind/config → le check plateforme pushe sur la **même** sonde, l'historique Kuma continue.
3. Laisser tourner en parallèle du workflow n8n 1-2 jours (deux pushers sur la même sonde = inoffensif, le plus pessimiste gagne).
4. Désactiver puis supprimer le workflow « Monitoring - Error Check » sur chaque instance.
5. **Révoquer/re-générer la clé API n8n** exposée en clair dans le JSON du workflow (et dans les snapshots versioning déjà exportés), mettre à jour la clé en DB plateforme.

## Hors scope (étapes suivantes)

- Sondes « mauvaise méthode » sur les webhooks de prod (provisionnées comme monitors HTTP Kuma natifs) — conception à part.
- Check « workflow planifié silencieux » (dernière exécution vs périodicité attendue) — pourra réutiliser le même gabarit de service et le curseur.
