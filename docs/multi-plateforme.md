# Ouvrir la plateforme à Make.com — recherche préalable (septembre 2026)

> **Palier 1 fait** le 2026-09-03 : `Instance.platform`, colonnes du miroir renommées en `external*`/`*Upstream` (migration `20260903210000_platform_rename`), `WorkflowPlatformPort` + `capabilities()` (`packages/core/src/ports/workflow-platform.port.ts`), `N8nPlatformAdapter`, route `GET /instances/:id/capabilities`, et le domaine rangé en `domain/n8n/` (62 fichiers) vs neutre (30). **Palier 2 entamé** le 2026-09-04 : adapter `packages/adapters/make-api` (auth, zone, pagination, budget d'appels, traduction), domaine pur `packages/core/src/domain/make/`, résolution par `Instance.platform`. Le miroir est branché depuis : synchro par plateforme, sauvegarde par `versioning`, création d'instance Make dans la console. **Palier 4 entamé** le 2026-09-04 : contrôles structurels Make (`runMakeChecks`) branchés dans `verifier`. **Palier 3 entamé** le 2026-09-05 : performance ET erreurs groupées pour Make. **Restauration** portée le 2026-09-13 : `WorkflowPlatformPort.updateWorkflow`, une version Make se réécrit par `PATCH /scenarios/{id}` (planning non restauré, `confirmed` jamais posé). **Export du blueprint** (bouton JSON), **naming des modules** (analyse + renommage) et **documentation générée** portés le 2026-09-13, ainsi que l'**assistant IA** en retouche de modules existants (pas d'ajout de module sans leur description) ; la sauvegarde GitHub/Drive servait déjà Make. Restent la revue IA et l'ajout de modules par l'assistant.

> Deux constats de terrain qui corrigent ce document : la limite d'appels est **30/min** sur un plan Free (et non 60 — elle se lit dans `license.apiLimit`), et un jeton d'une zone rejeté par une autre répond « Not authorized », strictement comme un droit manquant.
>
> Ce document tranche ce qui est faisable, ce qui ne l'est pas, et dans quel ordre.

La question posée : la plateforme gère des instances n8n et leurs workflows ; peut-elle gérer de la même manière des comptes Make.com et leurs scénarios ?

**Conclusion courte : oui pour la moitié des modules, non pour l'autre, et le partage ne passe pas là où on l'attend.** L'hexagonal joue à la frontière IO — `N8nApiPort` est un vrai port, un `MakeApiAdapter` est mécaniquement écrivable —, mais le domaine, lui, est n8n-shaped : 134 fichiers manipulent `N8nWorkflow`, et `Workflow.raw` EST du JSON n8n. Ce qui décide du périmètre n'est pas l'architecture, ce sont **quatre écarts d'API** (§3) : pas de données d'exécution, pas de catalogue de modules en REST, un plafond de 60 requêtes/minute, et pas de listing global des exécutions. Le plan proposé (§6) commence par le miroir et la sauvegarde — la valeur immédiate, et le seul socle sur lequel le reste peut se poser.

---

## 1. Le vocabulaire, terme à terme

| n8n | Make | Remarque |
|---|---|---|
| Instance (auto-hébergée, URL + clé API) | **Organisation** → **Teams**, dans une **zone** (`eu1`/`eu2`/`us1`/`us2.make.com`, plus les zones Celonis) | SaaS : rien à héberger, mais la zone fait partie de l'identité |
| Workflow | **Scénario** (`id` entier) | |
| JSON du workflow | **Blueprint** (`{name, flow[], metadata}`) | Écrit et lu en **chaîne de caractères** dans l'API, pas en objet |
| Nœud | **Module** (`"module": "google-sheets:addRow"`, `id` entier, `version`) | |
| `typeVersion` | `version` du module | |
| Paramètres | `parameters` (statique : compte, options) **+** `mapper` (dynamique : les valeurs mappées) | La séparation n'existe pas chez n8n |
| Expression `={{ $json.x }}` | `{{1.field}}`, `{{1.\`0\`}}`, `{{6.__IMTLENGTH__}}` | On référence un module par son **id entier**, pas par son nom |
| IF / Switch | `builtin:BasicIfElse` (+ `builtin:BasicMerge`) / `builtin:BasicRouter` | |
| Split In Batches | `builtin:BasicFeeder` + `builtin:BasicAggregator` (`parameters.feeder` = id de la source) | |
| Nœud Code | `code:ExecuteCode` | |
| Execute Workflow | module **Scenarios > Call a scenario** (sync ou async) | Même team obligatoire |
| Credential | **Connection** (`__IMTCONN__` dans `parameters`) | |
| Tag | **Label** (`/scenario-labels`) et/ou **dossier** (`folderPath`) | |
| Webhook | **Hook** (`/hooks`, avec `url`, `queueCount`, `enabled`) | |
| Archivé | rien — seulement une **corbeille** à 30 jours | |
| Exécution | **Execution** / log (`imtId`), plus les **incomplete executions** (DLQ) | |

Deux concepts sans équivalent chez n8n, et tous deux utiles : l'**interface de scénario** (`GET /scenarios/{id}/interface`, entrées/sorties déclarées — le contrat d'un sous-scénario, explicite au lieu d'être deviné), et le **compteur d'opérations/crédits** par exécution, que Make facture et expose.

## 2. Ce que l'API Make v2 donne

Base `https://<zone>/api/v2`, en-tête `Authorization: Token <token>` (OAuth 2.0 également disponible). Tout ce qui suit est du REST public documenté.

**Le miroir** — `GET /scenarios?teamId=` rend `id`, `name`, `folderId`/`folderPath`, `isActive`, `isPaused`, `islocked`, `isinvalid`, `concept`, `scheduling`, `lastEdit`, `dlqCount`, `createdByUser`, et surtout **`usedModules[]`** (`{packageName, moduleName}`) et `usedPackages[]` : l'inventaire des modules d'un scénario **sans télécharger son blueprint**. C'est ce que n8n ne donne pas, et ça change le coût d'une passe de découverte sur un parc entier.

**Le contenu** — `GET /scenarios/{id}/blueprint` (paramètres `blueprintId`, `draft`). L'écriture passe par `POST /scenarios` et `PATCH /scenarios/{id}`, avec le blueprint **sérialisé en chaîne** dans le corps. `POST /scenarios/{id}/start|stop|run|replay|clone|restore`.

**L'historique de contenu** — `GET /scenarios/{id}/blueprints` liste les versions (`created`, `version`, `draft`, `versionDescription`), **plafonné à 60 jours** par l'archivage de Make. C'est l'argument le plus fort en faveur du module `versioning` côté Make : au-delà de deux mois, Make lui-même ne sait plus rendre l'ancien blueprint. La plateforme, si.

**Les exécutions** — `GET /scenarios/{id}/logs` rend par exécution : `imtId`, `timestamp`, `status` (entier), `duration`, `operations`, `transfer`, `centicredits`, `instant`, `authorName`. Tout ce dont `performance` a besoin, **dans le listing**, là où n8n impose un aller-retour par exécution. `GET /scenarios/{id}/logs/{executionId}` pour une seule, `GET /scenarios/{id}/executions/{executionId}` pour son verdict (`RUNNING|SUCCESS|WARNING|ERROR`) avec `error.message` et `error.causeModule.{name,appName}` — le nœud fautif, nommé. `GET /scenarios/{id}/modules/{moduleId}/logs` descend au module (`bundles`, `size`, `warning.message`, `error.message`).

**Les échecs rattrapables** — `/dlqs?scenarioId=`, `/dlqs/{id}/bundle`, `/dlqs/{id}/blueprint`, `/dlqs/{id}/logs`, `POST /dlqs/{id}/retry`. Les *incomplete executions* de Make : une file d'attente d'exécutions plantées, rejouables. Rien de tel chez n8n, et c'est un module à soi seul.

**Le reste** — `/connections` (avec `expire` : la date d'expiration d'une connexion, que l'API n8n ne donne pas), `/hooks`, `/data-stores`, `/data-structures`, `/keys`, `/teams`, `/organizations` (dont `license.apiLimit`), `/scenario-labels`, `/scenarios-folders`, `/templates`, `/sdk/apps` (les apps custom de l'organisation), `/rpcs/{app}/{version}/{rpc}`.

### La forme d'un blueprint

```json
{
  "name": "Sync CRM",
  "flow": [
    { "id": 1, "module": "gateway:CustomWebHook", "version": 1,
      "parameters": {}, "mapper": {},
      "metadata": { "designer": { "x": 0, "y": 0, "name": "Webhook" } } },
    { "id": 2, "module": "google-sheets:addRow", "version": 2,
      "parameters": { "__IMTCONN__": 12345, "mode": "select" },
      "mapper": { "values": { "0": "{{1.email}}" } },
      "filter": { "name": "Only active",
                  "conditions": [[{ "a": "{{1.status}}", "b": "ACTIVE", "o": "text:equal:ci" }]] },
      "onerror": [ { "id": 3, "module": "<directive>", "mapper": { "retry": true, "count": "3", "interval": "900000" } } ] }
  ],
  "metadata": { "instant": true, "zone": "eu2.make.com",
                "scenario": { "roundtrips": 1, "maxErrors": 3, "sequential": false, "dlq": false },
                "designer": { "orphans": [] } }
}
```

Quatre points structurants pour tout contrôle qu'on écrirait :

- **Le graphe est un arbre, pas une liste d'arêtes.** n8n range les liens dans `connections`, à part des nœuds ; Make **imbrique** : les routes d'un `BasicRouter` vivent dans `routes[]`, les branches d'un `BasicIfElse` dans `branches[]`, les gestionnaires d'erreur dans `onerror[]`. Un parcours d'un blueprint est récursif par nature, là où `expression-reach.ts` raisonne sur des arêtes explicites. Ce n'est pas plus difficile — c'est simplement un autre parseur, à écrire en entier.
- **Les références sont des entiers.** `{{2.email}}` désigne le module d'id 2. Conséquence heureuse : renommer un module ne casse rien (le pendant de `optimizer`/renommage sûr disparaît, la moitié de son intérêt avec). Conséquence malheureuse : un id n'a aucun sens pour un humain, et l'affichage doit résoudre `metadata.designer.name`.
- **`filter` porte la logique conditionnelle**, en OU de ET (`conditions: [[{a,b,o}]]`), sur chaque module et sur chaque route. C'est là que se trouve l'équivalent de l'atteignabilité de `expression-reach.ts`.
- **La gestion d'erreur est une branche, pas un réglage.** Là où n8n pose `onError: continueRegularOutput` sur le nœud, Make accroche un **flux `onerror`** portant une directive — *Break* (l'exécution part en incomplete execution, rejouable), *Resume* (valeur de repli), *Ignore*, *Commit*, *Rollback*. L'équivalent du finding « erreur avalée » se lit donc sur la directive du gestionnaire, et non sur un booléen ; et un module sortant **sans aucun `onerror`** est le vrai signal d'absence de filet.
- **Make se déclare cassé lui-même.** Un scénario dont une connexion manque revient `isinvalid: true` et refuse de s'activer, et `metadata.designer.orphans` liste les modules décrochés. Deux contrôles que la plateforme n'a pas à écrire — mais qu'elle doit remonter.

## 3. Les quatre écarts qui décident du périmètre

**a. Aucune donnée d'exécution.** `GET /scenarios/{id}/executions/{executionId}` rend un statut, une erreur, un module fautif — **jamais les bundles**. La seule route qui rende de la donnée réelle est `/dlqs/{dlqId}/bundle`, c'est-à-dire uniquement pour les exécutions **plantées**. L'interface web de Make montre bien l'historique complet des bundles, mais par une API interne non documentée. Conséquence directe : **`field-checker` ne porte pas** (il reconstitue le schéma réel de sortie de chaque nœud en échantillonnant `includeData`), et **`ai-cost` ne porte pas non plus** — pas de `tokenUsage` à lire nulle part. Ce sont les deux seuls modules qui meurent d'un manque d'API, et non d'un manque de travail.

**b. Pas de catalogue de modules en REST.** *(Corrigé le 2026-09-05 — voir l'encadré en fin de §3.)* L'équivalent de `/types/nodes.json` — quels paramètres un module déclare, de quel type, sous quelle condition — n'existe pas dans l'API v2. Il existe, mais **dans le serveur MCP de Make** (`mcp.make.com`, outils de gestion `app-modules_list` / `app-module_get` au format *instructions*, `rpc_execute` pour les listes dynamiques), en accès anticipé et réservé aux plans payants. Donc : le module `node-catalog` a bien une contrepartie, mais elle se consomme par MCP et non par HTTP, et le port `NodeCatalogPort` devrait s'y plier. Tant qu'on ne la branche pas, **`node-schema.ts` n'a rien à comparer** et le contrôle le plus précieux de `verifier` — la sous-clé non déclarée — n'a pas d'équivalent Make.

> **Correction, après lecture d'un blueprint réel.** Ce point (b) est faux dans sa conséquence. Make **embarque la description de ses modules dans le blueprint lui-même** : `metadata.parameters[]` décrit les réglages statiques, `metadata.expect[]` décrit les champs du `mapper` — avec leur type, leur caractère requis, les valeurs admises (`validate.enum`) et la structure des collections (`spec`). Un contrôle de conformité au schéma est donc possible **sans aucun catalogue**, et il est écrit (`make-schema.ts`). La limite subsiste, mais ailleurs : ça ne décrit que les modules DÉJÀ présents. Pour un module qu'on voudrait AJOUTER — le cas d'un assistant qui propose —, le MCP reste nécessaire.

**c. 60 requêtes par minute** sur le plan Core (120 Pro, 240 Teams, 1 000 Enterprise ; lisible dans `license.apiLimit`). n8n auto-hébergé n'a rien de tel. Tout ce que la plateforme fait en masse — resynchro horaire, analyse d'un parc, export — doit devenir **budgété** : une file avec un débit réglé sur le plan de l'organisation, et non 4 appels de front comme le font les actions groupées.

**d. Pas de listing global des exécutions.** Chez n8n, `listAllExecutions` ramène tout le parc en quelques pages ; chez Make, les logs sont **par scénario**. Un poll `error-watch` sur 200 scénarios, c'est 200 requêtes, soit 3 minutes du budget Core à chaque passe. Deux atténuations réelles : `GET /scenarios` rend `dlqCount` pour tout le parc en un appel (on ne descend que dans les scénarios qui ont des échecs en attente), et `GET /scenarios/consumptions` rend la consommation de tous les scénarios d'une team en un appel. Le curseur par instance devient un **curseur par scénario**, et l'ordonnancement passe du cron naïf à une file.

## 4. Module par module

| Module | Verdict | Ce qui change |
|---|---|---|
| `instances` | **Porte** | `Instance` gagne `platform`, `zone`, `teamId`/`organizationId` ; la clé API remplace le couple URL+clé |
| `workflows` (miroir) | **Porte** | `usedModules[]` évite de tirer les blueprints ; `isinvalid`/`islocked`/`concept` s'affichent ; pas d'archivé, une corbeille à 30 j |
| `versioning` | **Porte, et c'est le meilleur argument** | Le blueprint est un JSON opaque à snapshoter ; Make oublie ses versions à 60 jours, pas nous. Export GitHub/Drive inchangé |
| `monitoring` (erreurs) | **Porte** | `error.causeModule.name` donne le nœud fautif directement ; signature/catégorisation/groupes/rechutes inchangés. Poll par scénario, budgété |
| `performance` | **Porte, mieux** | `duration`, `operations`, `transfer` sont **dans le listing** ; on peut suivre les opérations (ce que Make facture) et pas seulement la durée |
| `notifier` | **Porte tel quel** | Purement événementiel, ne connaît aucune plateforme |
| `dashboard` | **Porte** | `time-saved.ts` compte le geste humain remplacé : à réécrire pour les modules Make, même principe |
| `dep-graph` | **Porte, autre parseur** | Liens = module *Call a scenario*, appels HTTP vers un hook Make, data stores partagés. Ressources externes : relire `mapper`/`parameters`, sans `resourceLocator` ni `cachedResultName` — plus proche du cas NocoDB (que des ids) que du cas Airtable |
| `js-checker` | **Porte** | `code:ExecuteCode`, du JavaScript ; acorn, heuristiques, revue IA et localisation de ligne fonctionnent à l'identique |
| `doc-schema` | **Porte** | Mermaid depuis le blueprint, en descendant `routes`/`branches` |
| `config-transfer` | **Porte** | Une clé naturelle de plus (zone + organisation) |
| `workflow-groups`, `finding-ignores`, `check-profiles`, `app-logs` | **Portent** | Transverses, indépendants du contenu |
| `verifier` | **Porte à moitié** | Refs d'expressions (`{{id.x}}` → module inexistant), orphelins (déjà donnés par Make), fiabilité (absence de `onerror`, secret en clair, gabarit jamais remplacé), câblage des boucles (`parameters.feeder` pointant un non-feeder, `BasicIfElse` sans `BasicMerge`, filtres de merge en nombre ≠ branches) : **oui**. Conformité au schéma du module : **non tant que le MCP n'est pas branché**. Revue IA : oui, avec un autre prompt |
| `env-switcher` | **Porte, en partie natif** | `POST /scenarios/{id}/clone` fait DÉJÀ le remapping des connexions, hooks, data stores et keys vers une autre team : la promotion inter-env se pose dessus au lieu de réécrire les ids à la main. Reste à nous : l'appariement par nom, les gates, le semver, la chaîne d'environnements. Les labels remplacent les tags `env:<id>` |
| `optimizer` | **Porte à moitié** | Le renommage sûr perd sa raison d'être (les refs sont des entiers) ; le naming et les modules inutiles restent |
| `organizer` | **Porte** | Dossiers + labels au lieu des tags |
| `resource-discovery` | **Porte autrement** | Pas de workflow temporaire à créer : `rpc_execute` du MCP liste bases, tables et feuilles directement. Plus propre que ce qu'on fait chez n8n |
| `tester` | **Porte à moitié** | `POST /scenarios/{id}/run` avec entrées et `/replay` existent, mais **pas de `pinData`** : rien pour bouchonner un module. Le bouchonnage devrait passer par une réécriture du blueprint (remplacer le module sortant par un `util:SetVariable`), ce qui est un autre métier que d'épingler une donnée |
| `workflow-chat` | **Porte en dernier** | La boucle d'agent, les pièces jointes, l'export, la revue en diff sont génériques ; les **opérations d'édition** et la **porte** ne le sont pas. Sans porte déterministe, on écrit à l'aveugle dans le scénario d'un client — donc pas avant que §6 étape 4 soit faite |
| `assistant-learning` | **Suit `workflow-chat`** | Le mécanisme est agnostique, les leçons ne le sont pas : elles s'indexent sur des types de nœuds. Cloisonner par plateforme, sinon une règle n8n se sert sur un scénario Make |
| `field-checker` | **Ne porte pas** | Pas de bundles d'exécution (§3a) |
| `ai-cost` | **Ne porte pas** | Idem. À remplacer par un module **consommation** (opérations, crédits, transfert), que Make expose bien mieux que n8n — mais c'est un autre module, pas un portage |

## 5. L'architecture

Ne PAS généraliser le domaine. Un `Workflow` générique dont `raw` serait « du JSON d'une plateforme » ferait perdre aux contrôles n8n exactement ce qui fait leur valeur : leur spécificité.

**Un port, des capacités déclarées.** `WorkflowPlatformPort` reprend le dénominateur commun de `N8nApiPort` (lister, lire, écrire, activer, lister les exécutions, lire une erreur) et **déclare ce qu'il sait faire** : `{ executionData: false, nodeCatalog: 'mcp', pinData: false, tags: 'labels', archive: 'trash', rateLimitPerMin: 60 }`. Les modules interrogent la capacité et **disent qu'ils ne savent pas faire** plutôt que d'afficher un écran vide. Un onglet « Champs » vide sur un scénario Make est pire qu'un onglet absent : il fait croire que le contrôle est passé.

**Base.** `N8nInstance` devient `Instance` (`platform`, `zone`, `organizationId`, `teamId`), `Workflow.n8nId` devient `externalId`, `archivedInN8n`/`missingInN8nAt` deviennent `archivedUpstream`/`missingUpstreamAt`. Ce sont des renommages de colonnes : une migration, mécanique, à faire **en premier et d'un coup** — étalée, elle laisserait le schéma à moitié renommé pendant des semaines. `raw` reste tel quel : le JSON de la plateforme, lu par le code de cette plateforme.

**Domaine.** Ce qui parle de contenu se range par plateforme (`domain/n8n/`, `domain/make/`) ; ce qui parle de la plateforme à nous ne bouge pas (`error-signature.ts`, `execution-stats.ts`, `env-chain.ts`, `semver.ts`, `check-profile.ts`, `finding-key.ts`, `alert-digest.ts`, `time-saved.ts` en partie). Le déménagement des 134 fichiers est du `git mv` plus des imports : long, sans risque, et à faire avant d'écrire la moindre ligne de Make.

**Adapter.** `packages/adapters/make-api`, plus `packages/adapters/make-mcp` le jour où le catalogue de modules entre en jeu (client MCP, pas HTTP). Le budget de requêtes vit dans l'adapter et nulle part ailleurs : un module métier ne doit pas avoir à savoir qu'il parle à un plan Core.

## 6. Le plan

1. **Renommages et rangement** — migration Prisma, `domain/n8n/`, `WorkflowPlatformPort` avec ses capacités, `N8nApiAdapter` qui l'implémente. Aucun comportement ne change, rien n'est visible à l'écran. C'est le seul palier qui ne rapporte rien tout de suite et qu'il faut faire en entier.
2. **Miroir + sauvegarde Make** — adapter REST, synchro, `versioning`, export GitHub/Drive, budget de requêtes. **C'est le palier qui se vend seul** : Make oublie ses blueprints à 60 jours.
3. **Exécutions** — `monitoring` (groupes d'erreurs, rechutes, alertes) et `performance` (durée, opérations, transfert). Poll par scénario piloté par `dlqCount`. S'y greffe le module **incomplete executions**, propre à Make et sans équivalent n8n.
4. **Contrôles** — parseur de blueprint (récursif : `routes`, `branches`, `onerror`), refs d'expressions, fiabilité, câblage feeder/merge, `js-checker` sur `code:ExecuteCode`, revue IA. C'est ici qu'on décide de brancher ou non le MCP de Make pour le catalogue de modules.
5. **Environnements et promotion** — labels, `clone` avec remapping natif, gates, semver, chaîne d'environnements.
6. **Assistant** — seulement après 4, parce que la porte en dépend.

Chaque palier est utilisable seul. S'arrêter après 3 donne déjà « la plateforme surveille et sauvegarde nos Make », ce qu'aucun outil du marché ne fait à notre connaissance pour les deux plateformes à la fois.

## 7. Ce qu'on ne fera pas

- **Un modèle de workflow unifié.** Les deux JSON n'ont ni la même topologie ni la même notion de référence ; les unifier coûterait la précision des contrôles n8n pour ne rien gagner côté Make.
- **`field-checker` et `ai-cost` sur Make**, tant que l'API ne rend pas les bundles. Dire « à vérifier » vaut mieux qu'un écran qui ment.
- **Réécrire les workflows d'une plateforme vers l'autre.** Ça ressemble à la suite logique, ça n'en est pas une : `{{1.x}}` et `$('X').item.json.x` ne se traduisent pas sans connaître le schéma des deux côtés, et une traduction à 90 % est un piège.
- **Zapier, Power Automate.** Zapier n'expose pas les Zaps en lecture programmatique de façon comparable — sans blueprint, il n'y a ni sauvegarde, ni contrôle, ni diff, c'est-à-dire rien de ce que fait la plateforme. À réévaluer si leur API change.

## Sources

- [Make API — référence v2](https://developers.make.com/api-documentation/api-reference) (spécification OpenAPI intégrale : `https://developers.make.com/llms-full.txt`)
- [Scénarios](https://developers.make.com/api-documentation/api-reference/scenarios), [Blueprints](https://developers.make.com/api-documentation/api-reference/scenarios/blueprints), [Incomplete executions](https://developers.make.com/api-documentation/api-reference/incomplete-executions), [Connections](https://developers.make.com/api-documentation/api-reference/connections)
- [Rate limiting](https://developers.make.com/api-documentation/getting-started/rate-limiting) — 60/120/240/1 000 req/min selon le plan
- [`integromat/make-skills`](https://github.com/integromat/make-skills) (dépôt officiel Make) — [construction de blueprint](https://github.com/integromat/make-skills/blob/main/skills/make-scenario-building/blueprint-construction.md), [sous-scénarios](https://github.com/integromat/make-skills/blob/main/skills/make-scenario-building/subscenarios.md), [référence MCP](https://github.com/integromat/make-skills/blob/main/skills/make-mcp-reference/SKILL.md)
- [Serveur MCP de Make](https://developers.make.com/mcp-server) — accès anticipé, outils de gestion sur plans payants
