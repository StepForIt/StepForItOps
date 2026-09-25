# Audit des modèles IA — conception (septembre 2026)

> **Implémenté** le 2026-09-05 : module `model-audit` (`apps/api/src/modules/model-audit/`), catalogue partagé `infra/model-catalog/` (table `ModelPrice` renommée et élargie en `ModelCatalog`, migration `20260905120000_model_audit`), port `ModelPricingPort` + adapter `packages/adapters/model-pricing` (LiteLLM), domaine pur `model-catalog.ts` / `llm-task.ts` / `model-audit.ts` / `n8n/llm-node-requirements.ts`, page `/model-audit`, alerte `modelAudit.lifecycleChanged` branchée sur `notifier`. Écarts assumés à la conception : le seed du catalogue porte des aptitudes par défaut (`true`) là où la source amont les décrit, et le tier proposé par la source déclarative se déduit du prix faute de champ dédié — c'est précisément ce que le complément IA et l'édition à la main viennent corriger.
>
> Ce document tranche le périmètre, les règles et la source de vérité d'un module `model-audit` : trois contrôles sur les nœuds LLM des workflows — le modèle est-il *adapté* à ce que le nœud lui demande (A), est-il *encore vivant et pas payé trop cher* (B), et est-il *surdimensionné pour la tâche qu'on lui confie* (C).

La question posée : un workflow qui n'a pas bougé depuis six mois peut être devenu faux sans qu'aucune ligne n'ait changé, parce que le modèle qu'il appelle a été déprécié, retiré, ou remplacé par deux fois moins cher. Aucun contrôle existant ne voit ça : `verifier` juge la structure et le schéma des nœuds, `ai-cost` mesure la dépense sans jamais la juger.

L'axe qui rapporte le plus est le troisième, et c'est le seul qui ne se lise pas dans la structure : un Chat Model qui traduit ne demande ni outils, ni vision, ni long contexte — rien ne trahit que Sonnet y fait le travail de Haiku pour trois fois le prix. Il faut lire le **prompt réellement envoyé**, et c'est ce qui sépare le contrôle C de la suggestion d'économie ordinaire : `model-cheaper-alternative` conserve le tier et ne peut donc rien dégrader ; le contrôle C **descend** de tier, et seule la tâche l'y autorise.

**Conclusion courte : la moitié du travail est déjà en base.** `LlmUsage` dit quels modèles tournent, où, à quel volume et pour quel coût ; `ModelPrice` porte déjà les tarifs et le mécanisme de correspondance exact-puis-préfixe. Ce qui manque tient en deux choses : le **cycle de vie et les aptitudes** d'un modèle — statut, date de retrait, successeur, vision, outils, fenêtre de contexte —, c'est-à-dire quelques colonnes de plus sur la table qui existe et un rafraîchissement qui les tienne à jour ; et la **tâche** de chaque nœud, seule information qui ne se déduit d'aucune structure et qu'il faut donc classer, stocker et rendre corrigible. Le reste (findings, exclusions, « Corriger (IA) », alertes) est du chemin existant, à ne surtout pas doubler.

---

## 1. Pourquoi un module, et pas deux checks de plus dans `verifier`

`verifier` joue des contrôles **purs et sans IO** sur le contenu d'un workflow, à la demande. Deux choses ne rentrent pas dans ce moule :

- **L'audit est continu.** Le déclencheur n'est pas une modification du workflow, c'est une modification du **monde** : un modèle passe déprécié un mardi, et les quarante workflows qui l'appellent sont faux ce mardi-là sans que personne n'ait lancé d'analyse. Il faut un cron et un état, ce qu'un contrôle pur ne porte pas.
- **La réponse est une vue de parc.** « 14 workflows sur un modèle retiré en janvier » est l'information utile ; un finding par workflow la dit quatorze fois sans jamais la dire.

D'où un module métier désactivable `model-audit` (`apps/api/src/modules/model-audit/`), qui **produit des findings ordinaires** — donc « Corriger (IA) », `FindingIgnore`, la page `/findings` et les profils de contrôle marchent sans une ligne de plus — et sert en plus son propre écran de synthèse.

Ce qu'on perd à ne pas être dans `verifier`, et comment on le récupère :

| Perdu | Récupéré par |
|---|---|
| Le décochage par profil (`CheckProfile`) | `CheckModuleId` s'élargit à `model-audit`, deux groupes s'ajoutent à `CHECK_GROUPS` : le catalogue est déjà servi par l'API, l'UI ne change pas |
| L'appel depuis `runWorkflowChecks()` | Les règles restent **pures** et reçoivent le catalogue en paramètre, exactement comme `node-schema.ts` reçoit ses schémas ; `runWorkflowChecks()` n'a pas d'IO et n'en aura pas |
| La porte de l'assistant | Elle appelle les mêmes règles pures, avec le catalogue passé en paramètre (§4) |

Le module **lit directement les tables de `ai-cost`** (`LlmUsage`) sans jamais importer ses services : précédent `dashboard`, qui fait déjà exactement ça sur les tables de quatre modules. `ai-cost` coupé, l'audit perd la mesure d'usage et le dit ; il ne s'arrête pas.

## 2. La source de vérité : le catalogue des modèles

### 2.1 Une table élargie, pas une table sœur

`ModelPrice` devient **`ModelCatalog`** (renommage dans la migration qui l'élargit — une table qui porte un statut, des aptitudes et un successeur ne s'appelle pas « prix », et le renommer plus tard coûtera davantage). Elle sort de `apps/api/src/modules/ai-cost/` pour `apps/api/src/infra/model-catalog/`, module `@Global`, avec ses routes sous `/model-catalog` — **le catalogue de nœuds a déjà tranché la question** : une donnée de référence partagée par plusieurs modules vit dans `infra/`, pas dans l'un d'eux. Sans ce déplacement, éditer un tarif deviendrait impossible quand `ai-cost` est coupé alors que `model-audit` tourne.

Une seule table et non deux à clé `pattern` identique : le « moins cher à capacité égale » est une question qui lit le tarif ET les aptitudes dans la même phrase, et deux tables divergeraient au premier modèle ajouté d'un seul côté.

```prisma
model ModelCatalog {
  id                String   @id @default(uuid())
  /// Motif de correspondance, exact puis préfixe le plus long (llm-pricing.ts).
  pattern           String   @unique
  provider          String   // openai | anthropic | google | mistral | deepseek | …
  inputPerMTok      Float
  outputPerMTok     Float
  /// active | deprecated | retired | preview
  status            String   @default("active")
  deprecatedAt      DateTime?
  /// Date de retrait ANNONCÉE par le provider ; null = pas d'échéance connue.
  retiresAt         DateTime?
  /// Successeur recommandé par le provider, en `pattern` de cette même table.
  replacedByPattern String?
  /// light | standard | reasoning — le seul jugement de « puissance » qu'on porte.
  tier              String   @default("standard")
  /// null = ON NE SAIT PAS, et le contrôle correspondant SE TAIT. Jamais false par défaut.
  supportsVision    Boolean?
  supportsTools     Boolean?
  supportsStructuredOutput Boolean?
  contextWindow     Int?
  maxOutputTokens   Int?
  /// seed | custom | refresh — `custom` survit au re-seed, comme aujourd'hui.
  source            String   @default("seed")
  /// Dernière fois que la ligne a été CONFRONTÉE à une source, même sans changement.
  checkedAt         DateTime @default(now())
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

**Les aptitudes sont nullables, et c'est le point qui décide de la qualité de l'audit.** Une aptitude inconnue n'est pas une aptitude absente : `supportsVision: null` fait taire le contrôle de vision sur ce modèle, il ne le fait pas échouer. C'est la règle qui a fait passer le contrôle de schéma des nœuds de 1,52 à 0,02 finding par workflow — un trou de la description n'est pas une faute du workflow.

Trois booléens et non un `Json` d'aptitudes : trois est un nombre qu'on peut nommer et requêter ; une quatrième aptitude coûtera une migration, ce qui est honnête.

### 2.2 Le rafraîchissement : deux sources, aucune écriture sans revue

Un cron hebdomadaire (`ModelCatalogCron`, aligné sur celui du catalogue de nœuds — même rythme, même endroit) produit des **propositions**, jamais des écritures :

1. **Source déclarative, primaire.** Le `model_prices_and_context_window.json` de LiteLLM — déjà identifié comme source de facto dans [conception-couts-llm.md](conception-couts-llm.md), et déjà l'origine du seed actuel. Il donne tarifs, fenêtre de contexte et aptitudes (`supports_vision`, `supports_function_calling`, `supports_response_schema`), parfois une date de dépréciation. Déterministe, versionné, rejouable : c'est à lui qu'on fait confiance en premier, exactement comme n8n-mcp pour les nœuds. Rien n'est téléchargé tant que la révision amont n'a pas bougé.
2. **L'IA, en complément et sur le seul reste.** Statut annoncé, successeur recommandé, `tier` : ce que le fichier ne porte pas. La passe ne porte QUE sur les modèles **réellement présents dans le parc** (une trentaine au plus, lus dans `LlmUsage` et dans les `raw`), jamais sur les huit cents du fichier — et en `effort: low`, comme toute passe de masse.

Les deux versent dans `ModelCatalogProposal` (ligne par modèle et par champ changé : valeur actuelle, valeur proposée, origine, justification), revues et appliquées d'un clic groupé depuis la page. **Un tarif halluciné qui s'écrit tout seul empoisonne toute la chaîne en aval** — les coûts figés à l'ingestion, les économies annoncées, les alertes — et rien dans un `LlmUsage` ne dira ensuite d'où venait le chiffre. Une ligne `source: custom` est proposée comme les autres mais annoncée comme telle : c'est la seule que quelqu'un ait décidée à la main.

```prisma
model ModelCatalogProposal {
  id         String   @id @default(uuid())
  pattern    String
  field      String   // inputPerMTok | status | retiresAt | supportsVision | …
  currentValue Json?
  proposedValue Json?
  origin     String   // litellm | ai
  /// Ce sur quoi la proposition s'appuie : révision du fichier amont, ou phrase du modèle.
  evidence   String?
  createdAt  DateTime @default(now())
  appliedAt  DateTime?
  rejectedAt DateTime?

  @@index([pattern])
}
```

### 2.3 La fraîcheur, dite plutôt que supposée

`checkedAt` est mis à jour **même quand rien ne change** : c'est la seule façon de distinguer « ce modèle est toujours actif » de « personne n'a regardé depuis trois mois ». Au-delà de `catalogStaleDays` (défaut 60), les règles qui dépendent de la fraîcheur — obsolescence, alternative moins chère — **se taisent** et l'écran dit pourquoi (« catalogue confronté il y a 74 jours »). Les règles d'aptitude, elles, continuent : une image envoyée à un modèle sans vision est fausse indépendamment de la date.

Un catalogue périmé qui se tait vaut mieux qu'un catalogue périmé qui affirme.

## 3. Contrôle A — le modèle est-il adapté ?

### 3.1 Ce que le nœud demande, lu du JSON

Domaine pur `packages/core/src/domain/n8n/llm-node-requirements.ts` : un enregistrement par nœud modèle du workflow.

```ts
export interface LlmNodeRequirement {
  nodeName: string;
  /** Le modèle tel qu'il est ÉCRIT dans le nœud (resourceLocator ou chaîne). */
  model: string | null;
  /** L'alias est-il flottant (`-latest`, pas de date) ? */
  floating: boolean;
  needsVision: boolean;
  needsTools: boolean;
  needsStructuredOutput: boolean;
  /** Ce à quoi le modèle est rattaché, pour un message qui nomme le nœud utile. */
  servesNode: string | null;
}
```

Le type est **neutre** (`packages/core/src/domain/`), seul son producteur est n8n-shaped : c'est ce qui permettra à Make d'alimenter les mêmes règles sans les réécrire. Les paramètres sont lus par `activeParameters()` — un modèle laissé dans un nœud dont la config courante masque le champ n'est pas exécuté, et le juger serait juger du code mort.

Les signaux retenus sont **explicites uniquement** :

- `needsTools` — le modèle sert un Agent qui porte au moins une connexion `ai_tool`.
- `needsStructuredOutput` — un `ai_outputParser` est branché sur la même chaîne.
- `needsVision` — le paramètre image d'une chaîne LLM est renseigné (`imageUrls`, entrée binaire déclarée). On ne remonte PAS le graphe pour deviner qu'un binaire d'amont est peut-être une image : un signal inféré produit ici un `error`, et un `error` faux est le pire des findings.
- La **fenêtre de contexte** n'est pas lue du JSON : elle est **mesurée** (§3.3).

### 3.2 Les règles

| Code | Sévérité | Ce qu'elle dit | Pourquoi cette sévérité |
|---|---|---|---|
| `model-missing-vision` | `error` | Une image est envoyée à un modèle sans aptitude vision | L'appel échoue, ou pire, le modèle répond sur un texte vide |
| `model-missing-tools` | `error` | Un Agent porte des outils, le modèle ne sait pas les appeler | L'Agent tourne et n'appelle jamais rien : vert à l'écran, faux dans les faits |
| `model-missing-structured-output` | `warning` | Un parser structuré derrière un modèle sans sortie contrainte | n8n retombe sur un parsing best-effort : ça marche jusqu'au jour où non |
| `model-context-too-small` | `warning` | Le p95 mesuré des tokens d'entrée dépasse 80 % de la fenêtre | Mesuré, donc pas de finding sans usage réel |
| `model-oversized` | `info` | Un modèle de raisonnement là où rien ne demande outils, vision ni long contexte | Un signal d'économie, jamais un défaut. C'est la **moitié structurelle** du gâchis : elle ne voit que la plomberie, et reste muette sur une chaîne de traduction, qui ne demande rien de tout ça. La moitié qui manque est la tâche (§5) |

`data` porte toujours : `model`, `nodeName`, `requirement` (l'aptitude en cause), `catalogPattern` (la ligne du catalogue qui a servi à juger) et `suggestion` (le geste, affiché sous le message comme pour `reliability-checks`). Nommer la ligne du catalogue est ce qui permet à un humain de contredire le verdict au lieu de le subir.

### 3.3 La fenêtre de contexte se mesure, elle ne se devine pas

`LlmUsage.promptTokens` porte les tokens réellement envoyés, par nœud, par exécution. Le p95 sur 30 jours est un chiffre ; une estimation de la longueur d'un prompt à partir de son texte n'en est pas un — le prompt d'un Agent contient l'historique, les descriptions d'outils et les documents récupérés, dont rien n'est dans le JSON. Sans usage mesuré, la règle ne dit rien.

## 4. Contrôle B — cycle de vie et coût

| Code | Sévérité | Ce qu'elle dit |
|---|---|---|
| `model-retired` | `error` | Le modèle est retiré : l'appel échoue déjà, ou échouera au prochain passage |
| `model-deprecated` | `warning` | Déprécié, avec la date de retrait annoncée et le successeur quand ils sont connus |
| `model-floating-alias` | `warning` | Alias non épinglé (`…-latest`) : le modèle change sous les pieds du workflow sans qu'il bouge — le problème même que cet audit traite |
| `model-unknown` | `info` | Absent du catalogue : ni tarif ni jugement possible. **Dit**, jamais compté comme conforme — contrepartie exacte du coût `null` de `llm-pricing.ts` |
| `model-cheaper-alternative` | `info` | Même provider, aptitudes au moins égales, tier au moins égal, nettement moins cher |
| `model-cheaper-provider` | `info` | Idem chez un autre provider |

Deux codes distincts pour la même économie, parce que **le geste n'est pas le même** : changer de modèle chez le même provider est un paramètre ; changer de provider est un autre nœud, une autre credential, un autre format de sortie et un prompt à recaler. Le message le dit, et le second ne prétend pas être un correctif d'un clic.

**Un seul candidat est proposé** — le moins cher qui satisfait —, jamais une liste : un finding qui ouvre un comparatif ne se traite pas, il se referme.

### 4.1 Ce que « plus performant » a le droit de vouloir dire

Rien de mesuré ici. Un candidat n'est retenu que si :

- ses aptitudes **couvrent** celles que le nœud demande (une aptitude `null` disqualifie le candidat : on ne recommande pas ce qu'on ne connaît pas) ;
- son `tier` est **au moins égal** à celui du modèle en place ;
- sa fenêtre de contexte couvre le p95 mesuré quand il existe.

La plateforme ne dira jamais « ce modèle répond mieux » : elle n'a aucune mesure de qualité, et un benchmark maison serait une opinion déguisée en chiffre.

### 4.2 L'économie annoncée

- **Le pourcentage, toujours.** Calculé sur les tarifs. Sans usage mesuré, il n'est annoncé que si **input et output baissent tous les deux** — sinon le chiffre dépend du mix, qu'on ne connaît pas, et l'annonce serait un tirage au sort.
- **Le montant annuel, seulement quand des usages réels existent** : les tokens des 30 derniers jours revalorisés au tarif du candidat, extrapolés à l'année. L'écran distingue les deux comme il distingue déjà temps gagné mesuré et estimé.

Et surtout : **`model-cheaper-*` n'est émis en finding que pour les nœuds qui ont un usage mesuré**. Ailleurs, l'économie est théorique, et une sortie de modèle produirait quarante findings d'un coup sur des workflows qui ne coûtent rien. Le reste vit sur l'écran de parc, où il se lit d'un coup d'œil sans rien réclamer.

### 4.3 Les portes

Les trois `error` (`model-retired`, `model-missing-vision`, `model-missing-tools`) valent ce que vaut n'importe quel `error` :

- **La porte de l'assistant** les compte, dans tous les environnements, sur ce que la proposition INTRODUIT. Le catalogue lui est passé en paramètre, comme les schémas de nœuds ; catalogue absent ou périmé ⇒ la règle ne produit rien et ne bloque rien.
- **La promotion** est bloquée par le gate « findings error » existant, sans une ligne de plus. Promouvoir en prod un workflow qui appelle un modèle retiré est exactement ce qu'on veut empêcher.

## 5. Contrôle C — le modèle est-il surdimensionné pour la TÂCHE ?

C'est l'axe qui rapporte, et **aucun des deux précédents ne le voit** — `model-cheaper-alternative` compris, ce qui mérite d'être dit tout de suite parce que les deux se ressemblent de loin.

`model-cheaper-alternative` cherche un candidat **de tier au moins égal** (§4.1). C'est ce qui le rend sûr : à aptitudes couvertes et tier conservé, la bascule ne peut pas dégrader. Sonnet → Haiku est précisément l'inverse, une **descente de tier** : cette règle-là la refuse, et elle a raison de la refuser tant qu'on ne lui donne aucune raison de l'autoriser.

Un Chat Model branché sur une chaîne de **traduction** ne demande ni outils, ni vision, ni long contexte : `model-oversized` ne dit rien non plus, parce que rien dans la plomberie ne trahit un gâchis. Et pourtant Sonnet y coûte trois fois Haiku pour un résultat que personne ne saurait distinguer. **La raison qui autorise la descente est la tâche** — c'est tout l'objet de ce contrôle, et c'est la seule chose qui manque aux deux autres.

La difficulté est que la tâche n'est écrite nulle part dans le JSON : elle est **dans le prompt**, en français, et c'est du langage naturel. La tentation serait de demander au modèle « ce nœud est-il surdimensionné ? » et de publier sa réponse. C'est exactement ce qu'il ne faut pas faire : le verdict changerait d'une passe à l'autre, personne ne pourrait le contredire, et il n'y aurait rien à corriger quand il se trompe.

C'est donc **la même règle que `model-cheaper-alternative`, mais autorisée par l'usage** :

| | `model-cheaper-alternative` | `model-task-oversized` |
|---|---|---|
| Ce qui autorise la bascule | Le tier est **conservé** : rien ne peut se dégrader | La **tâche** se contente d'un tier inférieur |
| Ce qu'elle lit | Le catalogue et les aptitudes du nœud | En plus : le **prompt réellement envoyé** |
| Risque | Nul, par construction | Réel : la qualité peut baisser, d'où l'invitation à tester |
| Gain typique | Quelques dizaines de % | Un facteur, quand c'est Sonnet pour de la traduction |

Deux codes et non un seul, parce qu'un humain ne traite pas ces deux findings de la même façon : le premier s'applique, le second se discute. Les fondre reviendrait à noyer la bascule sûre dans celle qui demande un avis.

D'où une **coupure en deux**, la même que partout ailleurs dans la plateforme.

### 5.1 Classer la tâche — travail de l'IA, résultat stocké

Un appel par nœud modèle (`effort: low`), qui ne rend **qu'une étiquette** parmi une liste fermée, plus une confiance et la phrase du prompt sur laquelle il s'appuie :

`translation` · `classification` · `extraction` · `summarization` · `rewriting` · `generation` · `code` · `reasoning` · `conversation` · `unknown`

Le résultat est **stocké** (`LlmNodeTask` : workflow + nœud + **empreinte du prompt**) : le prompt ne bouge pas, la classification ne se repaie pas ; il change, elle est refaite. Et il est **corrigible à la main** à l'écran — une correction humaine n'est jamais écrasée par une passe suivante, exactement comme `minutesSavedPerExecution` prime sur l'estimation.

Le modèle ne juge JAMAIS l'adéquation : il ne sait pas ce que coûte Haiku, et on ne le lui dit pas. Il nomme la tâche, rien d'autre. Deux cas où l'on ne classe pas du tout plutôt que de classer mal : prompt vide, et confiance sous le seuil. `unknown` ne produit aucun finding.

### 5.1 bis Le prompt **envoyé**, pas le prompt écrit

Le troisième cas — un prompt fait surtout d'expressions (`={{ $json.texte }}`) — est le plus fréquent et le plus intéressant, parce que c'est celui où le gabarit ne dit rien et où la donnée dit tout. « Traduis ceci : {{ $json.corps }} » est classable ; « {{ $json.consigne }} » ne l'est pas, et c'est pourtant souvent le même nœud.

Le texte réellement soumis existe : il est dans les données d'exécution, à l'endroit exact où `ai-cost` va déjà chercher les tokens (`inputOverride.ai_languageModel[].json.messages`, le champ écrit par `handleLLMStart`). On l'échantillonne comme `field-checker` échantillonne ses sorties : **quelques exécutions récentes, pas l'historique**, et seulement quand le gabarit statique ne suffit pas.

Trois précautions qui ne sont pas négociables :

- **Ce qu'on envoie au modèle est de la donnée de production.** Le prompt exécuté contient les vraies valeurs des clients. Il passe par `redactSecrets` (`secret-patterns.ts`, la définition partagée avec `reliability-checks` et les exemples de l'assistant) et n'est transmis que **borné** — un extrait de tête suffit à nommer une tâche, l'intégralité d'un document ne sert à rien et sortirait de la maison pour rien.
- **`capabilities().executionData`** commande : sans données d'exécution lisibles, on retombe sur le gabarit statique, et si celui-ci est muet la classification n'a pas lieu. Elle ne devine pas.
- **L'empreinte porte alors le gabarit, pas l'échantillon** : deux exécutions ne donnent jamais le même texte, et une empreinte sur l'échantillon reclasserait le nœud à chaque passe — c'est-à-dire un appel IA par nœud et par nuit, pour redire la même étiquette.

### 5.2 Décider ce que la tâche exige — une table, pas une opinion

```prisma
/// Tier minimal jugé suffisant pour une tâche. Livré avec des valeurs par défaut,
/// éditable : c'est un arbitrage d'équipe, pas une vérité, et il doit se contredire
/// à un endroit précis plutôt que dans le prompt d'un modèle.
model ModelTaskProfile {
  task      String   @id // translation | classification | …
  minTier   String   // light | standard | reasoning
  /// Pourquoi ce plancher, affiché à côté du réglage.
  rationale String?
  source    String   @default("seed") // seed | custom
  updatedAt DateTime @updatedAt
}
```

Défauts livrés : `light` pour traduction, classification, extraction, résumé et réécriture ; `standard` pour génération, conversation et code ; `reasoning` pour le raisonnement multi-étapes. Ce sont des positions défendables, pas des mesures — d'où la colonne `rationale`, et le fait qu'elles s'éditent en trois clics.

### 5.3 La règle

| Code | Sévérité | Ce qu'elle dit |
|---|---|---|
| `model-task-oversized` | `info` | La tâche du nœud se contente d'un tier inférieur, et un candidat de ce tier existe chez le même provider : voici le moins cher, et voici ce qu'il fait gagner |

Message type : *« Traduction : un modèle léger suffit. `claude-sonnet-5` → `claude-haiku-4` chez le même provider, −73 % sur le tarif, ~184 $/an aux volumes des 30 derniers jours. À vérifier sur un cas de test avant bascule. »*

`data` porte `task`, `taskConfidence`, `taskEvidence` (la phrase du prompt qui a servi), `currentTier`, `requiredTier`, `candidate`, `savingsPct`, `savingsAnnualUsd`. Nommer la phrase qui a fait le verdict est ce qui permet de répondre « non, ce n'est pas de la traduction » au lieu d'ignorer la règle.

Quatre garde-fous, tous nécessaires :

- **Jamais plus qu'`info`.** Un `warning` supposerait que la plateforme sait que le résultat restera aussi bon. Elle ne le sait pas : elle sait que la tâche appartient à une famille pour laquelle l'équipe a posé un plancher.
- **Usage mesuré obligatoire**, et mêmes seuils que `model-cheaper-*`. Une économie théorique sur un workflow qui ne tourne pas est du bruit.
- **Le candidat doit couvrir les aptitudes du contrôle A.** Descendre de tier ne dispense de rien : un modèle sans vision reste refusé sur une chaîne à images.
- **Le finding dit qu'il faut vérifier.** Un downgrade change la qualité de la sortie ; il renvoie vers les cas de test enregistrés du module `tester` quand le workflow en a, et le dit quand il n'en a pas — c'est précisément le moment d'en enregistrer un.

### 5.4 Ce que ça ne devient pas

Pas de matrice modèle × tâche à entretenir (« Haiku est bon en traduction, moyen en code ») : elle vieillirait plus vite que le catalogue et personne ne saurait d'où sortent ses cases. Le `tier` fait tout le travail. Si un modèle dément son tier sur une tâche précise, ça se dit une fois, à la main, sur sa ligne de catalogue (`weakAtTasks`, `custom`) — l'exception nommée plutôt que la matrice supposée.

## 6. Ce que l'IA fait, et ce qu'elle ne fait pas

Le socle est **déterministe** et se suffit : aptitudes, statuts, tarifs, mesures. L'IA n'intervient qu'à deux endroits, et jamais comme arbitre :

1. **Le rafraîchissement du catalogue** (§2.2) — et sa sortie est une proposition revue, pas une écriture.
2. **La classification de la tâche** (§5.1) — et elle ne rend qu'une étiquette d'une liste fermée, stockée et corrigible ; c'est une **table** qui décide ensuite si cette tâche justifie le modèle en place.

Le partage est le même que pour la proposition de version et l'estimation de temps gagné : **le déterministe est à la fois le défaut et le repli**. IA non configurée ⇒ `model-oversized` continue de tourner sur sa moitié structurelle, `model-task-oversized` se tait, et rien d'autre ne bouge.

L'IA n'invente jamais un statut, une date, un tarif ni un verdict d'économie : tous viennent des tables, ou le finding n'existe pas.

## 7. Le bruit

Un audit de parc qui crie à chaque sortie de modèle serait abandonné en deux semaines.

- **Cadence** : cron quotidien pour l'audit du parc, plus le bouton de la page workflow et l'appel groupé depuis `/findings`. Le catalogue, lui, ne bouge qu'une fois par semaine : auditer plus souvent ne découvrirait rien.
- **Seuils** (`ModelAuditSettings`, ligne unique) : `savingsThresholdPct` (défaut 30), `minAnnualSavingsUsd` (défaut 5), `catalogStaleDays` (défaut 60). En deçà, on se tait.
- **Exclusions** : `FindingIgnore` avec sa portée famille par défaut — un modèle assumé en dev l'est aussi en prod.
- **Coût de la classification** : un appel par nœud modèle **et par empreinte de prompt**, jamais par passe. Un parc de trente nœuds LLM se classe une fois, puis plus rien tant que les prompts ne bougent pas — sans ce cache, le cron quotidien repaierait tout le parc chaque nuit pour redire la même chose.
- **Réécriture** : chaque passe résout puis réécrit les findings du module, comme les autres analyses. Le regroupement par nœud de `findings-list.tsx` fait le reste : les trois remarques d'un même Chat Model se traitent d'un geste.

## 8. Périmètre et limites assumées

- **Couvert** : les sub-nodes Chat Model LangChain (`@n8n/n8n-nodes-langchain.lm*`) et les nœuds HTTP Request qui visent un provider connu (`llm-http-usage.ts` sait déjà les reconnaître ; le modèle s'y lit dans le corps de requête, pas toujours — s'il est porté par une expression, on ne juge pas).
- **Hors périmètre v1, et DIT à l'écran** : embeddings, rerankers, transcription, images. Unité de facturation différente, aptitudes sans rapport ; les compter conformes serait mentir, les compter fautifs aussi.
- **Make** : `not-yet`, et pas `platform`. Les modules `openai:*` d'un blueprint portent bien un modèle, rien n'empêche de les lire — nous ne l'avons pas fait. La distinction est celle de `workflowActions()` : une dette, pas une limite du fournisseur. `capabilities().executionData` étant faux, les règles mesurées (`model-context-too-small`, `model-cheaper-*`, `model-task-oversized`) n'y tourneront de toute façon jamais.
- **Tarifs publics uniquement** : ni remise volume, ni tarif négocié, ni batch, ni cache. Le cache est d'ailleurs déjà fusionné dans `promptTokens` par n8n, donc invisible ici comme il l'est dans `ai-cost`.
- **Un changement de modèle ne transpose pas un prompt.** Le finding le dit dans sa `suggestion` plutôt que de laisser croire qu'une bascule est neutre.

## 9. L'écran

Page `/model-audit`, deux onglets.

**Parc** — une ligne par modèle : provider, statut et date de retrait, nombre de workflows et de nœuds, **répartition des tâches classées** (« 6 traduction, 2 extraction, 1 raisonnement »), coût mesuré sur 30 jours, économie annuelle si l'on bascule (mesurée, ou muette), et le successeur proposé. La colonne des tâches est ce qui fait comprendre d'un coup d'œil pourquoi un modèle cher n'a rien à faire là. C'est ici que « 14 workflows sur un modèle retiré en janvier » se lit. Le coût compte **tous les environnements** — un appel LLM en dev est une dépense réelle, `ai-cost` a déjà tranché ça —, mais l'urgence est colorée par env : un modèle retiré en prod n'est pas la même nuit qu'un modèle retiré en dev.

**Tâches** — les nœuds classés, leur étiquette, la confiance et la phrase qui l'a produite, corrigibles d'un clic ; et les planchers par tâche (`ModelTaskProfile`) avec leur justification. C'est l'endroit où l'on conteste, plutôt que dans un prompt.

**Catalogue** — les propositions de rafraîchissement en attente, appliquées ou rejetées en lot, avec la fraîcheur de chaque ligne et l'édition manuelle des tarifs (qui déménage ici depuis la page Coûts IA, laquelle continue d'y renvoyer).

Routes : `POST /model-audit/run` (`?instanceId=`, `?workflowId=`), `GET /model-audit/summary`, `GET/PUT /model-audit/settings`, `GET/PUT /model-audit/tasks` (classifications et corrections), `GET/PUT /model-audit/task-profiles`, toutes derrière `@ModuleId('model-audit')`. Le catalogue lui-même est servi hors module : `GET/PUT/POST /model-catalog`, `GET /model-catalog/proposals`, `POST /model-catalog/proposals/apply`.

## 10. Alertes

Un événement, `modelAudit.lifecycleChanged`, émis **quand l'application d'une mise à jour du catalogue fait passer un modèle PRÉSENT DANS LE PARC** en `deprecated` ou `retired` :

```ts
export interface ModelLifecycleChangedEvent {
  pattern: string;
  from: string; // active | preview | deprecated
  to: string;   // deprecated | retired
  retiresAt: string | null;
  replacedByPattern: string | null;
  /** Ce que ça touche : de quoi écrire un message actionnable sans rien recalculer. */
  workflows: Array<{ name: string; env: string | null; nodeName: string }>;
  occurredAt: string;
}
```

**Une alerte par transition de modèle, pas par workflow** — sinon un message Slack par nœud touché, et la même information quatorze fois. Toggle par canal `onModelLifecycle`, comme `onPerfDrift` et `onBudget`. Garde d'amorçage : le **premier** remplissage du catalogue n'alerte sur rien, faute de quoi la mise en service du module annoncerait comme une nouvelle tout ce qui est déprécié depuis deux ans — c'est le pendant de la garde anti-backfill du `notifier`.

## 11. Ce qu'on ne fait pas, et pourquoi

- **Pas de bascule automatique.** Le correctif passe par « Corriger (IA) », donc par une proposition d'édition revue en diff : c'est un changement de comportement du workflow, pas une mise à jour de dépendance.
- **Pas de jugement de qualité mesuré.** Aucun benchmark n'est joué ici. Le seul jugement porté est un **plancher par tâche**, posé dans une table éditable et assumé comme un arbitrage d'équipe (§5.2) — pas une mesure, et surtout pas l'opinion d'un modèle au moment du finding.
- **Pas de matrice modèle × tâche.** Voir §5.4 : le `tier` fait le travail, les exceptions se nomment une par une.
- **Pas de suivi des tarifs négociés** ni de rapprochement avec la facture du provider — `ai-cost` a déjà écarté le contrôle de cohérence billing-API, et l'audit n'a pas besoin du montant exact pour dire qu'un modèle coûte trois fois le prix d'un équivalent.
- **Pas d'appel réseau vers les providers.** Ni ping d'un modèle pour vérifier qu'il répond, ni lecture de leurs pages de tarifs en HTML : la source déclarative est versionnée et rejouable, une page de marketing ne l'est pas.
- **Pas de finding sur un modèle inconnu du catalogue**, au-delà de l'`info` qui le signale. Ne pas savoir n'est pas une faute du workflow.

---

## Entrée pour le tableau des modules de CLAUDE.md

| `model-audit` | audit continu des modèles LLM employés par les workflows, sur trois axes. **Adapté** : les aptitudes du modèle confrontées à ce que le nœud demande — vision envoyée à un modèle sans vision, outils branchés sous un modèle qui n'appelle rien, parser structuré sans sortie contrainte, fenêtre de contexte trop courte face au p95 **mesuré** dans `LlmUsage`. **Encore raisonnable** : retiré, déprécié avec sa date, alias flottant, ou remplaçable par nettement moins cher **à tier conservé** — cette bascule-là ne peut rien dégrader, c'est ce qui la rend sûre. **Surdimensionné pour la tâche** : le seul axe qui ne se lise dans aucune structure, et celui qui rapporte — un Chat Model qui traduit ne demande ni outils, ni vision, ni long contexte, donc rien ne trahit que Sonnet y fait le travail de Haiku pour trois fois le prix. Il faut lire le **prompt réellement envoyé** — celui du gabarit quand il parle, sinon un échantillon borné et passé par `redactSecrets` pris dans les exécutions, là même où `ai-cost` va chercher les tokens — et le tout est coupé en deux : l'IA nomme la TÂCHE (liste fermée, `effort: low`, résultat stocké par empreinte du GABARIT et corrigible à la main, une correction n'étant jamais réécrite), une TABLE éditable dit quel tier cette tâche exige (`ModelTaskProfile`, avec sa justification). Demander directement au modèle « est-ce surdimensionné ? » aurait donné un verdict qui change à chaque passe et que personne ne peut contredire. Toujours `info`, jamais plus : la plateforme sait que la tâche appartient à une famille pour laquelle l'équipe a posé un plancher, elle ne sait pas que le résultat restera aussi bon — d'où le renvoi vers les cas de test du module `tester`. Le déclencheur n'est pas la modification d'un workflow mais celle du monde — un modèle meurt un mardi et quarante workflows deviennent faux ce mardi-là —, d'où un cron et un état plutôt que des checks de plus dans `verifier` ; les règles restent PURES et reçoivent le catalogue en paramètre, comme `node-schema.ts` reçoit ses schémas, ce qui les rend jouables par la porte de l'assistant. La source de vérité est `ModelCatalog` (ex-`ModelPrice`, élargie au statut, aux aptitudes, au successeur et à la fenêtre de contexte, et déménagée en `infra/model-catalog/` : une donnée de référence partagée ne vit pas dans un module désactivable, cf. le catalogue de nœuds), rafraîchie par un cron hebdomadaire qui ne fait que **proposer** — source déclarative versionnée d'abord, IA en complément sur les seuls modèles du parc — parce qu'un tarif halluciné écrit tout seul empoisonne les coûts figés, les économies annoncées et les alertes, sans que rien ne dise ensuite d'où venait le chiffre. Une aptitude inconnue est `null` et **fait taire** le contrôle plutôt que de valoir `false` ; un catalogue confronté il y a plus de 60 jours fait taire tout ce qui dépend de la fraîcheur, en le disant. Trois `error` seulement (modèle retiré, vision manquante, outils manquants) : elles bloquent la porte et la promotion comme n'importe quel `error`. L'économie annoncée donne toujours le pourcentage, et le montant annuel seulement là où des usages réels existent — les suggestions d'économie ne deviennent des findings que sur les nœuds mesurés, le reste vivant sur la page `/model-audit` (par modèle : statut, parc touché, répartition des tâches classées, coût 30 j, économie), sinon une sortie de modèle produirait quarante findings sur des workflows qui ne coûtent rien. Lit directement `LlmUsage` sans importer les services d'`ai-cost` (précédent `dashboard`) ; émet `modelAudit.lifecycleChanged` — une alerte par transition de modèle et non par workflow, muette au premier remplissage du catalogue |
