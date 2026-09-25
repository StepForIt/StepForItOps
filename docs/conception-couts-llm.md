# Suivi des coûts LLM — recherche préalable (août 2026)

> **Implémenté** le 2026-08-20 : module `ai-cost` (`apps/api/src/modules/ai-cost/`), domaine pur `packages/core/src/domain/llm-usage.ts` + `llm-pricing.ts`, page `/llm-costs`. La recommandation du §5 est le plan suivi. Depuis : extraction des nœuds **HTTP Request** vers les providers connus (`llm-http-usage.ts`), **alerte de budget quotidien** (`aiCost.budgetExceeded` → notifier), et encart coût sur la page workflow. Reste : le contrôle de cohérence billing-API.

Où vivent les tokens dans une exécution n8n, comment les outils existants les captent et les tarifient, et ce que ça implique pour la plateforme, qui polle déjà l'API des exécutions.

**Conclusion courte : tout est extractible de ce qu'on récupère déjà.** Les nœuds Chat Model LangChain écrivent `tokenUsage` (ou `tokenUsageEstimate`) dans le `runData` de leur propre sub-node, et `GET /api/v1/executions/:id?includeData=true` renvoie ce runData complet, sub-nodes inclus. Ni proxy, ni variable d'env, ni instrumentation des workflows. Le seul morceau à construire est la table de prix modèle → $/token (source de facto : le JSON de LiteLLM, ou `genai-prices` de Pydantic).

## 1. Où n8n expose les tokens

### Le mécanisme : le callback `N8nLlmTracing`

Chaque nœud Chat Model (OpenAI, Anthropic, Gemini…) instancie un callback LangChain [`N8nLlmTracing`](https://github.com/n8n-io/n8n/blob/master/packages/%40n8n/ai-utilities/src/utils/n8n-llm-tracing.ts). À la fin de chaque appel LLM (`handleLLMEnd`), il écrit la réponse **dans les données d'exécution du sub-node lui-même**, sur la connexion `ai_languageModel` :

- `tokenUsage` — les chiffres **réels** renvoyés par le provider ;
- `tokenUsageEstimate` — une **estimation** tiktoken locale, utilisée quand le provider ne renvoie rien (cas typique du streaming).

Les deux champs sont **mutuellement exclusifs** et ont la même forme : `{ promptTokens, completionTokens, totalTokens }`. La clé présente sert de flag « estimé ou réel » (c'est ce que fait l'UI n8n dans [`logs.utils.ts`](https://github.com/n8n-io/n8n/blob/master/packages/frontend/editor-ui/src/features/execution/logs/logs.utils.ts)).

Détail Anthropic : [le nœud Anthropic](https://github.com/n8n-io/n8n/blob/master/packages/%40n8n/nodes-langchain/nodes/llms/LMChatAnthropic/LmChatAnthropic.node.ts) fournit son propre parser qui lit `usage.input_tokens` / `output_tokens` et **additionne les tokens de cache** (`cache_creation_input_tokens`, `cache_read_input_tokens`) dans `promptTokens` — impossible donc de distinguer cache read et input frais côté n8n, et un coût calculé au tarif input plein surestime légèrement les workflows qui cachent.

### Le chemin exact dans le JSON d'exécution

```
data.resultData.runData["<nom du Chat Model>"][runIndex]
  .data.ai_languageModel[callIndex][itemIndex].json
    .tokenUsage            // ou .tokenUsageEstimate
    = { promptTokens, completionTokens, totalTokens }
```

Trois points structurants :

- Les tokens sont rattachés au **sub-node** (le Chat Model), jamais à l'AI Agent : l'Agent ne propage pas les tokens dans sa sortie ni dans `intermediateSteps` ([issue #26302](https://github.com/n8n-io/n8n/issues/26302), fermée sans implémentation ; [fil communautaire](https://community.n8n.io/t/allow-reading-ai-sub-node-execution-data-e-g-token-usage-from-main-flow-nodes/307504)). C'est ce qui rend l'extraction impossible *en expression dans le workflow*… mais triviale de l'extérieur, en lisant le runData.
- Détection robuste : plutôt que de filtrer par type de nœud, parcourir chaque entrée de `runData` et chercher une clé `data.ai_languageModel` — ça capte tous les Chat Models, quel que soit le provider.
- Le **nom du modèle n'est pas dans `tokenUsage`** : il se lit dans les données d'*input* du même sub-node (le champ `options` enregistré à `handleLLMStart` : `{ messages, estimatedTokens, options }`), ou en secours dans `Workflow.raw` (paramètre `model` du nœud) — déjà en base.

### L'API publique renvoie bien tout ça

Le handler de `GET /api/v1/executions/:id?includeData=true` ([code](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/public-api/v1/handlers/executions/executions.handler.ts)) renvoie le même runData que l'UI, sub-nodes inclus — pas de troncature spécifique. Preuve d'usage : les templates officiels [#7265](https://n8n.io/workflows/7265-track-and-monitor-ai-token-usage-metrics-for-openai-and-gemini-models/) et [#15177](https://n8n.io/workflows/15177-track-ai-agent-token-costs-and-store-receipts-with-the-n8n-api-and-data-tables/) font exactement cet appel. Deux réserves réelles :

- **Garde de taille** : au-delà de `EXECUTIONS_DATA_MAX_DISPLAY_SIZE` (défaut 100 Mo), l'exécution revient *sans* runData — contournable avec `?ignoreDataSizeLimit=true`. C'est l'origine des témoignages « l'API omet des données ».
- **Réglages de sauvegarde** : `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none` (ou le réglage équivalent par workflow) supprime le runData des succès ⇒ aucun token lisible ; le pruning (`EXECUTIONS_DATA_PRUNE` / `EXECUTIONS_DATA_MAX_AGE`) purge les données ⇒ 404. Le poller doit passer *avant* la purge et signaler les workflows configurés en « ne pas sauvegarder ».

### Les nœuds HTTP Request qui appellent l'API LLM en direct

Aucun mécanisme spécial : le corps de réponse du provider **est** la sortie du nœud, donc le champ `usage` est dans le runData normal :

```
runData["<HTTP Request>"][i].data.main[0][j].json.usage
  // OpenAI    : { prompt_tokens, completion_tokens, total_tokens }
  // Anthropic : { input_tokens, output_tokens,
  //               cache_creation_input_tokens, cache_read_input_tokens }
```

Captable par heuristique (URL du nœud dans `Workflow.raw` → provider, présence d'un objet `usage` dans la sortie), en phase 2. Attention au nœud OpenAI « classique » (non-LangChain) dont l'option *Simplify* peut retirer `usage` de la sortie.

## 2. Comment font les outils existants

| Outil | Mécanisme d'ingestion | Prérequis n8n | Granularité |
|---|---|---|---|
| **Administrate.dev** | Sync quotidienne des **billing APIs** des fournisseurs (clés read-only OpenAI/Anthropic/Azure/OpenRouter), mapping manuel projet → client | Aucun (workflows non touchés) | Projet fournisseur / jour — *pas* par workflow ni exécution |
| **Langfuse** | Pas de tracing natif n8n : community nodes (callback dans le node), route OpenRouter, ou shipper OTel externe qui patche `WorkflowExecute` | Self-host (nodes, shipper) ; rien via OpenRouter | Appel LLM ou exécution complète |
| **Helicone** | **Proxy HTTP** : Base URL du credential → `oai.helicone.ai/v1` / `anthropic.helicone.ai` + header `Helicone-Auth` | Le credential n8n ne pose pas le header — node HTTP Request ou leur AI Gateway self-hosted | Appel LLM (tokens, coût, latence) |
| **LangSmith** | Seule intégration documentée par n8n : callbacks LangChain activés par env (`LANGCHAIN_TRACING_V2`, `LANGCHAIN_API_KEY`) | **Self-host**, redémarrage, projet global à l'instance | Runs LangChain |
| **OTel natif n8n** | Export OTLP officiel (preview) depuis n8n 2.19 (`N8N_OTEL_ENABLED`…) ; spans GenAI des agents depuis 2.33 (`N8N_AGENTS_TRACING_ENABLED`) | Self-host + env + backend OTel | Workflow + nœuds + appels agents |
| **Portkey / LiteLLM / OpenRouter** | Gateway : Base URL du credential OpenAI → la passerelle, qui compte tokens et budgets (virtual keys LiteLLM) | Un changement de credential, compatible n8n cloud | Appel LLM, budgets par clé |
| **n8nTrace** | Push : deux workflows n8n fournis écrivent dans le Postgres de l'outil | Installer les workflows collecteurs | Exécutions/nœuds — **aucun tracking LLM** |
| **Templates n8n.io** | (a) sub-workflow qui relit sa propre exécution via l'API ; (b) push webhook ; (c) polling batch des workflows tagués | Instrumenter chaque workflow (a, b) ou taguer (c) | Par nœud et par modèle |

Lecture transversale : **personne ne fait « polling externe + granularité nœud/exécution »**, la case que la plateforme peut occuper. Les proxys sont aveugles au contexte workflow (ils voient des appels HTTP, pas des exécutions) ; les billing APIs sont aveugles à tout sauf au projet ; les templates communautaires obligent à modifier chaque workflow ; l'OTel natif est le seul concurrent sérieux mais exige self-host + n8n ≥ 2.19 + un backend de traces, là où le poller marche sur n'importe quelle instance dont on a la clé API.

### Administrate.dev, en détail

Leur page [/llm-cost-tracking](https://administrate.dev/llm-cost-tracking) est explicite : « You connect your LLM provider accounts (OpenAI, Anthropic, Azure, OpenRouter) using API keys with read-only billing access », « We sync billing data daily », attribution aux clients par mapping projet → client. Leur [billet de blog](https://administrate.dev/blog/tracking-costs-across-openai-anthropic-azure) assume le parti pris : pour une agence, le vrai problème est l'*attribution client*, résolue par l'isolation par clé/projet fournisseur. Conséquence : coûts par client, modèle, fournisseur, tendance quotidienne, alertes budget par client — mais jamais « ce workflow a coûté 0,42 $ sur cette exécution ». Leur monitoring n8n est un pipeline séparé. L'angle par exécution est donc complémentaire et plus précis ; leur angle billing a une vertu que le nôtre n'aura pas : il capte *tout* ce qui passe par la clé, y compris hors n8n, et fait foi face à la facture.

## 3. La table de prix (tokens → dollars)

Le pattern commun à tous les outils : table locale embarquée en fallback + refresh périodique depuis une source publique, matching à trois niveaux (exact > pattern > **null** — jamais de prix deviné pour un modèle inconnu), et coût « ingéré » au moment de l'appel prioritaire sur coût recalculé plus tard.

- **LiteLLM** — la source de facto : [`model_prices_and_context_window.json`](https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json) (MIT, 1000+ entrées, PRs continues). Objet plat clé = id de modèle, valeurs en USD/token : `input_cost_per_token`, `output_cost_per_token`, `cache_read_input_token_cost`, `cache_creation_input_token_cost`, paliers `*_above_200k_tokens`… LiteLLM le re-télécharge au démarrage avec fallback local.
- **pydantic/genai-prices** ([GitHub](https://github.com/pydantic/genai-prices), MIT) — la source la plus soignée : 35 providers, 1100+ modèles, **historique de prix daté** (recalculer un coût passé avec le tarif du jour est faux), paliers de contexte, package JS/TS disponible. Agrège LiteLLM, Helicone, OpenRouter, llm-prices.
- **Langfuse** ([doc](https://langfuse.com/docs/model-usage-and-cost)) : définitions `Model` avec `match_pattern` regex, prix par « usage type » mutuellement exclusifs, modèles custom par projet prioritaires sur la liste maintenue (tarifs négociés, fine-tunés), audit quotidien automatisé contre les pages de prix officielles. Modèle inconnu ⇒ coût null.
- **Helicone** ([packages/cost](https://github.com/Helicone/helicone/blob/main/packages/cost/README.md)) : matching par opérateurs simples (`equals`/`startsWith`/`includes`), champs cache 5min/1h pour Anthropic, `dateRange` pour historiser les changements de prix.

**Pièges confirmés** : paliers de contexte (Claude/Gemini > 200k) ; les trois tarifs de cache Anthropic (écriture 5 min 1,25×, écriture 1 h 2×, lecture 0,1×) — d'autant que n8n fusionne déjà les tokens de cache dans `promptTokens` ; batch API à −50 % (attribut de l'appel, pas du modèle) ; reasoning tokens facturés en output ; ids différents par canal (`claude-…` vs `anthropic.claude-…-v1:0` Bedrock) ; modèles fine-tunés absents des tables publiques.

## 4. Restitution UX (Langfuse, Helicone, templates)

- **Drill-down coût par workflow → exécution → nœud/modèle**, avec courbe quotidienne *empilée input vs output* (le ratio input/output est le premier levier d'optimisation visible).
- **Distinction visible « réel » vs « estimé »** (Langfuse : coût ingéré prioritaire sur inféré ; ici : `tokenUsage` vs `tokenUsageEstimate`).
- **Dimensions d'attribution libres** filtrables partout (custom properties Helicone : client, feature, env) — ici, l'instance et les tags n8n jouent ce rôle naturellement.
- **Alertes de seuil filtrées par dimension** (Langfuse : une alerte par env/segment) et rapports périodiques (Helicone). L'enforcement dur (bloquer) est partout délégué aux gateways — l'observabilité alerte, elle ne coupe pas.
- Table de prix **éditable dans l'UI** avec les prix par défaut importés, et coût `null` affiché « modèle inconnu » plutôt que 0.

## 5. Recommandation pour la plateforme

Le monitor `error-watch` polle déjà les exécutions. Le module coûts est le même pattern appliqué aux succès :

1. **Ingestion** : pour chaque exécution pollée, un `GET /executions/:id?includeData=true` ; parcourir `runData`, retenir chaque entrée ayant `data.ai_languageModel`, en extraire un enregistrement par appel LLM : nœud, run, `promptTokens`/`completionTokens`/`totalTokens`, flag `isEstimate`, modèle (input du sub-node, fallback `Workflow.raw`). Domaine pur à la `execution-samples.ts` — un `llm-usage-extract.ts` dans `packages/core`, testable sur des JSON d'exécution fixtures.
2. **Persistance** : une ligne par appel LLM (`LlmUsage` : execution, workflow, instance, node, model, tokens, coût calculé *au moment de l'ingestion* + version/date du tarif appliqué), agrégats journaliers recalculables — même philosophie que le `recount` d'`ErrorGroup`.
3. **Pricing** : embarquer un snapshot du JSON LiteLLM (ou genai-prices) + refresh manuel/planifié + table `ModelPrice` éditable en DB qui prime ; matching exact puis préfixe ; inconnu ⇒ coût null, jamais 0.
4. **Contraintes à afficher honnêtement** : exécutions dont le runData n'est pas sauvegardé ou déjà purgé (« couverture partielle »), tokens estimés vs réels, cache Anthropic fusionné dans l'input.
5. **Phase 2** : heuristique HTTP Request → provider (le champ `usage` en sortie), et éventuellement un connecteur billing-API à la Administrate comme *contrôle de cohérence* mensuel entre le total calculé et la facture réelle.

Coût du polling : c'est l'appel `includeData=true` qui pèse (tout le payload de l'exécution). `field-checker` échantillonne déjà ce même endpoint — mutualiser la récupération entre modules (un seul fetch par exécution, plusieurs consommateurs derrière l'event bus) évitera de doubler la charge sur les instances.

## Sources

- **n8n (code)** : [N8nLlmTracing](https://github.com/n8n-io/n8n/blob/master/packages/%40n8n/ai-utilities/src/utils/n8n-llm-tracing.ts) · [LmChatAnthropic](https://github.com/n8n-io/n8n/blob/master/packages/%40n8n/nodes-langchain/nodes/llms/LMChatAnthropic/LmChatAnthropic.node.ts) · [logs.utils.ts](https://github.com/n8n-io/n8n/blob/master/packages/frontend/editor-ui/src/features/execution/logs/logs.utils.ts) · [executions.handler.ts](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/public-api/v1/handlers/executions/executions.handler.ts) · [executions.config.ts](https://github.com/n8n-io/n8n/blob/master/packages/%40n8n/config/src/configs/executions.config.ts)
- **n8n (issues/forum)** : [#26302](https://github.com/n8n-io/n8n/issues/26302) · [fil 307504](https://community.n8n.io/t/allow-reading-ai-sub-node-execution-data-e-g-token-usage-from-main-flow-nodes/307504) · [fil 94671](https://community.n8n.io/t/how-to-get-ai-token-usage-information-from-ai-agent/94671) · [fil 204788](https://community.n8n.io/t/is-there-a-way-to-retrieve-runtime-excution-data-with-api/204788)
- **Templates** : [#7398](https://n8n.io/workflows/7398-llm-usage-tracker-and-cost-monitor-with-node-level-analytics-v2/) · [#5541](https://n8n.io/workflows/5541-track-ai-agent-token-usage-and-estimate-costs-in-google-sheets/) · [#9497](https://n8n.io/workflows/9497-ai-model-usage-dashboard-track-token-metrics-and-costs-for-llm-workflows/) · [#15177](https://n8n.io/workflows/15177-track-ai-agent-token-costs-and-store-receipts-with-the-n8n-api-and-data-tables/) · [#7265](https://n8n.io/workflows/7265-track-and-monitor-ai-token-usage-metrics-for-openai-and-gemini-models/) · [#6002](https://n8n.io/workflows/6002-track-openai-admin-api-usage-and-costs-automatically-with-google-sheets/)
- **Administrate** : [/llm-cost-tracking](https://administrate.dev/llm-cost-tracking) · [/features](https://administrate.dev/features) · [blog](https://administrate.dev/blog/tracking-costs-across-openai-anthropic-azure)
- **Langfuse** : [intégration n8n](https://langfuse.com/integrations/no-code/n8n) · [model usage & cost](https://langfuse.com/docs/model-usage-and-cost) · [token & cost tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking) · [community node](https://github.com/rorubyy/n8n-nodes-openai-langfuse) · [shipper OTel](https://github.com/rwb-truelime/n8n-langfuse)
- **Helicone** : [proxy OpenAI](https://docs.helicone.ai/getting-started/integration-method/openai-proxy) · [how we calculate cost](https://docs.helicone.ai/references/how-we-calculate-cost) · [packages/cost](https://github.com/Helicone/helicone/blob/main/packages/cost/README.md) · [AI Gateway](https://github.com/Helicone/ai-gateway)
- **LangSmith / OTel** : [trace with n8n](https://docs.langchain.com/langsmith/trace-with-n8n) · [OTel natif n8n](https://docs.n8n.io/deploy/host-n8n/keep-n8n-running/trace-executions-with-opentelemetry) · [OpenLLMetry](https://github.com/traceloop/openllmetry)
- **Gateways** : [Portkey × n8n](https://portkey.ai/docs/integrations/libraries/n8n) · [LiteLLM proxy](https://docs.litellm.ai/docs/simple_proxy) · [virtual keys](https://docs.litellm.ai/docs/proxy/virtual_keys)
- **Pricing** : [LiteLLM JSON](https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json) · [genai-prices](https://github.com/pydantic/genai-prices) · [llm-prices](https://github.com/simonw/llm-prices) · [OpenRouter models API](https://openrouter.ai/docs/overview/models)
- **Autres** : [n8nTrace](https://github.com/Mohammedaljer/n8nTrace) · [Lunary](https://lunary.ai/integrations)
