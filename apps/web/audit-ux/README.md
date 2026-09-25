# Audit UX — l'outil

Ouvre chaque écran de la console, en desktop (1440 px) et en mobile (390 px), mesure,
et rend un rapport daté dans `docs/audit-ux/AAAA-MM-JJ-<env>.md`.

Il existe pour que l'audit **se rejoue** : deux rapports datés se comparent ligne à
ligne, et une régression d'ergonomie se voit comme une régression de test.

## Installation

Rien à installer à part les dépendances du dépôt (`pnpm install`) et le navigateur :

```bash
pnpm --filter @nwm/web exec playwright install chromium
```

## Lancer

```bash
pnpm audit:ux -- --env=local
```

| option | effet |
|---|---|
| `--env=<nom>` | le profil d'environnement (défaut `local`) |
| `--headed` | montre le navigateur, pour voir ce que l'audit voit |
| `--only=a,b` | ne parcourt que ces écrans (leur `id` dans `screens.mjs`) |
| `--report-only` | refait le rapport à partir des mesures déjà prises, sans rouvrir un navigateur |
| `--check-map` | vérifie que la carte des écrans est à jour du registre de menu |
| `--warmup` | précompile les routes avant de mesurer (utile contre un build de production, coûteux et instable contre `next dev`) |

## Variables

Elles vivent dans `.env` **à côté de ce fichier** (ignoré par git ; modèle dans
`.env.example`), ou dans l'environnement du shell. Aucun identifiant n'est écrit dans le
code.

| variable | rôle |
|---|---|
| `AUDIT_<ENV>_URL` | l'adresse de la console. Déclarer la variable **crée** l'environnement : `AUDIT_STAGING_URL` rend `--env=staging` utilisable |
| `AUDIT_<ENV>_USERNAME` / `_PASSWORD` | la connexion identifiant / mot de passe, si l'environnement en demande une |
| `AUDIT_USERNAME` / `AUDIT_PASSWORD` | le même couple, sans préfixe, quand un seul environnement est audité |

`local` vaut `http://localhost:3000` par défaut, et ne demande rien tant que la console
tourne avec `AUTH_OPTIONAL=1` (le cas de `docker-compose.override.yml`).

## Ce qui est mesuré

Par écran et par largeur : le temps d'ouverture, les erreurs console, les requêtes en
échec, **axe-core** (WCAG 2.0/2.1 niveaux A et AA), les métriques de formulaire (champs
visibles, nommés, obligatoires signalés, repliés derrière un « avancé »), la densité
(part de la surface visible qui porte du contenu, plus grande bande vide, largeur
utile, débordement horizontal), et la présence des états vide / chargement / erreur.

Et sur le parcours : le bouton Précédent après l'ouverture d'un écran, le rechargement
d'une adresse profonde, et l'existence d'une recherche globale (champ ou ⌘K).

## Lecture seule

Le parcours n'écrit **rien**. Il navigue par adresse, suit des liens, ouvre des
formulaires — il n'en remplit et n'en soumet aucun. Un garde réseau posé sur le contexte
Playwright coupe toute requête `POST` / `PUT` / `PATCH` / `DELETE` sortante, la connexion
exceptée : si une sonde déclenchait une écriture par accident, la requête n'arrive
jamais, et le rapport le dit. C'est la condition pour lancer l'audit sur un
environnement peuplé.

## Les cinq fichiers

| fichier | rôle |
|---|---|
| `screens.mjs` | la carte des écrans (recopiée du registre `RESOURCES` de `refine-app.tsx`) |
| `probes.mjs` | les **sondes** : ce qui mesure, dans la page. Aucun seuil |
| `thresholds.mjs` | les **seuils** : ce qui juge. Aucun accès au navigateur |
| `report.mjs` | le rapport Markdown, à partir des mesures |
| `envs.mjs` | les profils d'environnement, lus des variables |

Sondes et seuils sont séparés exprès : on doit pouvoir **rediscuter un seuil sans
reparcourir l'application** (`--report-only`), et reparcourir l'application sans
rediscuter les seuils.

## Ajouter un écran

Une entrée dans `SCREENS` (`screens.mjs`) : un `id` stable — il sert de clé de
comparaison entre deux rapports —, un `label`, un `path`, un `kind`
(`list` / `form` / `detail` / `dashboard`, qui décide des sondes jouées), et `module`
si l'écran appartient à un module désactivable. Un écran de détail qui a besoin d'un
enregistrement réel se déclare `reach: 'record'` avec la liste d'où tirer son adresse.

`pnpm audit:ux -- --check-map` échoue si une entrée `list:` du registre de menu n'a pas
son écran ici.

## Ajuster un seuil

Le chiffre est dans `THRESHOLDS` (`thresholds.mjs`), avec la raison qui l'a fixé —
laisser la raison à jour, un seuil qu'on ne sait plus justifier ne se discute plus.
Puis :

```bash
pnpm audit:ux -- --env=local --report-only
```

## Constats de revue de code

Ce qu'un parcours automatique ne voit pas — une confirmation absente, un effet de bord
non dit, deux écrans qui nomment la même action différemment — se lit dans le code et
s'écrit dans `findings-code.json`, que le rapport fusionne avec les constats mesurés.
Une équipe priorise **une** liste, pas deux.

## Limites connues

- **Le temps d'ouverture ne se juge pas contre `next dev`.** Le serveur de développement
  compile chaque route à sa première visite : le même écran passe de 3 s à 39 s selon ce
  que le compilateur a en cache. Le chiffre reste affiché, le constat est supprimé, et le
  rapport le dit. Pour un verdict de performance, viser un build de production.
- **`next dev` se redémarre tout seul au milieu d'un parcours.** Trente routes compilées
  à la suite lui font franchir son propre seuil mémoire (« Server is approaching the used
  memory threshold, restarting… »). Le parcours l'attend et réessaie une fois par écran ;
  c'est aussi pourquoi `--warmup` n'est pas le défaut.
- **Une base vide donne un audit partiel.** Les pages de détail se déclarent « non
  atteintes », et les contrôles de flux (Précédent, adresse profonde) ne sont pas
  vérifiables faute d'adresse à ouvrir. Un environnement peuplé mesure beaucoup plus —
  d'où la lecture seule.
- **Un écran non atteint n'est pas un échec.** Module désactivé, droits manquants, 404 :
  la raison est notée et l'audit continue.
- **axe-core ne voit que ce qui est rendu.** Un formulaire replié, une modale fermée, un
  tiroir jamais ouvert ne sont pas analysés.
- **Les violations d'axe issues d'antd ne sont pas distinguées de celles du code
  applicatif.** Les libellés manquants sur les `Select` viennent de la bibliothèque ;
  les interrupteurs sans nom, non. Le tri se fait à la lecture.
- **Le parcours est mono-utilisateur.** Il ouvre une session et la réutilise : rien n'est
  dit des écrans que d'autres droits feraient apparaître.
