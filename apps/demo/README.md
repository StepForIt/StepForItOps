# Mode démo

La **vraie console** sur un parc **fictif** : deux clients, 17 workflows, 45 jours d'histoire, un n8n et une IA de façade. Pour une démo commerciale, pour écrire une scène, et c'est ce que filme la vidéo promo.

```bash
export DATABASE_URL=postgresql://nwm:nwm@localhost:55444/nwm_demo   # même conteneur que les tests, base « …_demo »
pnpm --filter @nwm/demo stack        # ~5 min (builds) → http://localhost:3020, demo / demo-promo
```

La base est **vidée** à chaque lancement : `scripts/api.sh` et `seed.mjs` refusent toute base dont le nom ne finit pas par `_demo`.

## Ce qu'il y a dedans

| fichier | rôle |
|---|---|
| `dataset.mjs` | deux clients fictifs (Maison Lumière, Cabinet Verdier), 17 workflows au format exact de l'API n8n, en dev et prod ; des défauts posés exprès (jeton en clair, référence à un nœud renommé), la dev de « Facturation mensuelle » a un nœud d'avance sur la prod |
| `seed.mjs` | 45 jours d'histoire (exécutions, erreurs regroupées dont une rechute, dérive de durée, appels LLM), graine fixe, datés par rapport à maintenant |
| `demo-n8n.mjs` | plusieurs instances derrière un port (`/i/<instance>`), avec un état : promotion et assistant écrivent pour de vrai |
| `demo-ai.mjs` | réponses écrites d'avance, reconnues à leur consigne : aucune clé, aucun appel facturé |
| `scripts/` | `api.sh` (build, schéma, seed, api), `web.sh` (console en build de production), `stack.sh` (tout), `env.sh` (ports et identifiants) |

Une consigne d'IA qui change dans le produit doit être reconnue par `demo-ai.mjs`, sinon la démo répond à côté.

## Le contrat avec le studio vidéo

Le montage et les scènes de la vidéo promo vivent dans le studio (`StepForIt/video-studio`, `projects/stepforit-ops`). Ce dépôt ne porte qu'une chose : son **vocabulaire**, `studio/product.ts` à la racine. Il dit au studio comment démarrer le mode démo, entrer, mettre le parc en état, et nomme les écrans et les zones que les scènes filment.

```
studio ──► charge studio/product.ts (lib déposée dans .studio/kit, ignorée par git)
       ──► lance pnpm --filter @nwm/demo n8n | ai | api | web   (DATABASE_URL, ports de env.sh)
       ──► se connecte, met le parc en état, joue les scènes avec les noms du vocabulaire
```

Chaque nuit, le studio rejoue ses scènes à blanc : si un écran ou un bouton a changé au point d'en casser une, sa fiche le dit, avec l'écran fautif. On corrige alors ici, dans le vocabulaire (structure : route, sélecteur, port), ou dans la scène du studio (texte à l'écran). Une zone marquée `data-studio="<nom>"` dans l'interface n'a pas besoin d'entrée dans le vocabulaire : c'est la forme la plus stable.
