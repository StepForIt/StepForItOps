# Rapatrier un hotfix de prod

> Statut : **conception, à valider avant code.**

## En une phrase

Un correctif fait en urgence en prod redescend en preprod et en dev **sans écraser ce qui y a été construit depuis**. Aujourd'hui la plateforme le voit (« prod modifiée »), mais ne sait que le montrer ou l'écraser par une promotion.

```
                 1.4.0 (dernière mise en service)
                 /                           \
     PROD : hotfix sur « Envoi mail »     DEV : nœud « Relance » ajouté
                 \                           /
       DEV après rapatriement : mail corrigé + Relance gardée, aucune question
```

| Cas | Ce qui se passe | Qui décide |
|---|---|---|
| Nœud touché par la prod seule | repris tel quel | personne (automatique) |
| Nœud touché par dev seul | gardé tel quel | personne |
| Même nœud touché des deux côtés | **conflit** : l'IA propose une fusion | l'humain, en diff |
| Pas d'IA configurée | conflit rendu à l'humain : prod, dev ou à la main | l'humain |
| Rien à rapatrier | geste grisé, avec la raison | — |

Rien n'est jamais écrit sans passer par la même revue en diff que l'assistant IA.

## Pourquoi c'est possible sans rien stocker de plus

Le mécanisme est une **fusion à 3 voies**, comme `git merge` : on compare chaque côté à leur **ancêtre commun**, pas l'un à l'autre. Comparer prod et dev directement ne peut pas dire qui a bougé : un nœud différent peut être le hotfix comme le travail en dev.

L'ancêtre est déjà en base. Une promotion estampille le `semver` sur le dernier snapshot de **tous** les exemplaires qu'elle touche, source comprise (`stampVersion`, `instance-promoter.service.ts`). Si la prod est en `1.4.0`, alors :

- **base** = le snapshot de DEV estampillé `1.4.0`, déjà dans les termes de dev (ids dev, paths dev) : aucune traduction ;
- **ours** = DEV tel que n8n le sert aujourd'hui (`getFreshRaw`) ;
- **theirs** = PROD aujourd'hui, **traduit dans les termes de dev** par les outils de la promotion : ressources basculées par `ResourceMapping`, sous-workflows repointés par nom, `pinData` retiré.

C'est la lignée de `ReleaseStateService`, lue sur la cible au lieu de la source.

## Algorithme (domaine pur, `packages/core/src/domain/n8n/three-way-merge.ts`)

1. **Apparier les nœuds** des trois versions par id n8n, puis par nom (même règle que `workflow-diff.ts`, qui reconnaît déjà un nœud renommé).
2. **Décider sur la forme normalisée** (`deployForm`, même contexte que la colonne « Écart prod ») : un id de table mappé, un path de webhook ou un suffixe d'env ne sont pas des changements. **Écrire la vraie valeur** du côté retenu. Sans ça, chaque nœud Airtable passerait pour « modifié des deux côtés ».
3. Pour chaque nœud :
   - identique partout, ou changé d'un seul côté : on prend ce côté ;
   - changé des deux côtés de la même façon : rien à faire ;
   - changé des deux côtés différemment : **conflit** ;
   - supprimé d'un côté, modifié de l'autre : **conflit**, jamais une suppression silencieuse.
4. **Connexions** : même règle, arête par arête (source, sortie, cible). Une arête ajoutée par la prod vers un nœud que dev a supprimé est un conflit.
5. **Réglages du workflow** (`settings`, workflow d'erreur) : même règle, clé par clé.
6. Le résultat est rendu en **opérations d'édition** (`workflow-edit.ts`) : il passe ainsi par le même chemin que l'assistant (porte `proposal-gate`, revue, point de retour).

Sortie : `{ merged, autoApplied[], conflicts[], noop }`.

### Conflits

- **Avec IA** : un seul appel par workflow avec les conflits seulement (nœud base / ours / theirs, en forme normalisée et secrets masqués). L'IA rend des opérations d'édition. Elle ne voit jamais le reste du workflow, déjà tranché.
- **Sans IA, ou IA en échec** : chaque conflit est proposé en trois choix (garder dev, prendre prod, éditer à la main dans le chat). La fonctionnalité ne dépend jamais de l'IA (même règle que `version-bump`).
- La proposition passe par la **porte** : une `error` introduite bloque, contournable par `force`.

### Sans ancêtre

Une prod jamais promue par la plateforme n'a pas de snapshot estampillé. On bascule en **diff à 2 voies** : chaque nœud différent devient un conflit, annoncé comme tel (« pas d'historique commun : tout écart est à trancher »). L'écart n'est jamais pris pour un hotfix.

## Propagation : on remonte la chaîne

```
PROD ──► PREPROD ──► DEV        (chaîne déclarée, env-chain.ts)
         fusion 1    fusion 2   (chacune avec sa revue)
```

- Une fusion par étape, dans l'ordre. L'étape 2 part de la PREPROD **déjà fusionnée**, si bien que le hotfix arrive en dev traduit étape par étape.
- Un env sans exemplaire est sauté et annoncé.
- Une branche sœur (recette client A) n'est pas visée par défaut : elle se coche.
- Un conflit met l'étape **en attente** : les étapes amont ne partent pas sur une base non tranchée.

## Points d'entrée

| Où | Geste |
|---|---|
| Modale d'écart (tag « prod modifiée ») | « Récupérer le correctif » devient l'action principale. « Voir le correctif en prod » passe en secondaire |
| Assistant Environnements (fiche workflow) | nouveau geste « Rapatrier un hotfix », grisé quand l'exemplaire n'est pas `behind` |
| Actions groupées (familles cochées en `behind`) | plan → aperçu → application, comme la promotion de masse. Readiness : `ready` (aucun conflit), `decide` (conflit ou diff à relire), `blocked` (verrou, chaîne `block`). Écritures une par une |

## Routes (module `env-switcher`)

```
POST /env-switcher/backport/:id/preview   { envs?: string[] }  → étapes, auto, conflits, readiness
POST /env-switcher/backport/:id/apply     { envs?, resolutions?, force? }
```

`:id` est l'exemplaire de **prod** (la source du correctif). Aucune route de masse : le lot appelle ces routes famille par famille, comme `bulk-env`.

## Garde-fous

- La **prod n'est jamais écrite**.
- **Verrou** (`WorkflowLock.assertWritable`) et **chaîne** (`EnvChainGuardService`) sont vérifiés pour toutes les cibles **avant** la première écriture.
- Toute lecture qui mène à une écriture repart de n8n.
- **Empreinte de départ** : si dev a bougé entre l'aperçu et l'application, on refuse et on refait l'aperçu.
- **Aucune version posée** : éditer en amont ne fait pas de release. Le numéro bougera à la prochaine promotion, qui ne verra plus d'écart sur ce correctif.
- Un snapshot `versioning` par cible écrite sert de point de retour.
- **Make** : `not-yet` dans `workflowActions`.
- Pas capté par les procédures de mise en ligne (v1).

## Découpage en commits

1. `three-way-merge.ts` + tests (red first) : nœuds, arêtes, réglages, renommage, suppression contre modification, sans ancêtre.
2. `BackportService` (ancêtre par semver, traduction, propagation) + tests de service.
3. Routes, readiness et i18n (fr/en).
4. Résolution IA des conflits (`effort: low`) et repli humain.
5. UI : modale d'écart, assistant Environnements, actions groupées.
6. CLAUDE.md (ligne `env-switcher`) et astuce `/aide`.

## Questions ouvertes

1. **Horodatage de l'estampille** : `stampVersion` marque le *dernier* snapshot de chaque exemplaire. Il faut vérifier que la resynchro de la cible écrite a bien eu lieu avant, sinon l'ancêtre serait le snapshot d'avant la promotion. À couvrir par un test, et à corriger dans `stampVersion` si besoin.
2. **Granularité du conflit** : par nœud (proposé, simple et lisible) ou par paramètre (moins de conflits, diff plus dur à relire) ? La v1 se fait par nœud, l'IA absorbant la finesse.
3. **Promotion suivante** : après rapatriement, dev contient le hotfix et son propre travail. La prochaine promotion dev → prod affichera donc les deux, ce qui est attendu. À confirmer côté UX.
