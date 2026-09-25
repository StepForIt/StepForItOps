#!/bin/sh
# Démarre l'api compilée dans l'arbre `--prod` de l'image, et refuse le build
# si un module manque à l'appel. Joué comme une couche du Dockerfile : un
# déploiement qui ne démarrerait pas échoue ici, au lieu de partir en
# production et d'y redémarrer en boucle.
#
# Ce que ce contrôle attrape, et que rien d'autre n'attrapait :
# TypeScript vérifie qu'un import a des types, jamais que le paquet sera là au
# runtime. Un import de VALEUR d'une dépendance seulement transitive
# (`import { json } from 'express'` sans express dans package.json) compile,
# passe le typecheck, tourne parfois en dev par un node_modules plus permissif
# — et meurt au boot de l'image de prod.
#
# Deux formes, dont la seconde est muette :
# - dans main.ts et ce qu'il importe statiquement → l'api sort en MODULE_NOT_FOUND ;
# - dans un module métier → `loadFeatureModules` avale l'erreur en warning et
#   la plateforme démarre AMPUTÉE du module, sans que rien ne soit rouge.
#
# D'où le tri sur le specifier plutôt que sur l'échec : un module dont le
# DOSSIER a été supprimé échoue sur un chemin relatif — c'est le comportement
# voulu, documenté, et le build doit passer. Un module qui échoue sur un nom
# de paquet (`express`, `@nestjs/…`, `@nwm/…`) est une dépendance oubliée.
set -e
cd "$(dirname "$0")/.."

LOG=$(mktemp)
# Port fermé : Prisma échoue en P1001 après avoir tout chargé. C'est le boot
# qu'on teste, pas la base — l'image n'en a aucune à sa disposition.
# La sortie non nulle qui s'ensuit est attendue : seul le journal fait foi.
DATABASE_URL="postgresql://smoke:smoke@127.0.0.1:1/smoke" \
  timeout 120 node dist/apps/api/src/main.js > "$LOG" 2>&1 || true

fail() {
  echo "SMOKE BOOT: ÉCHEC — $1"
  echo "--- journal du démarrage ---"
  cat "$LOG"
  exit 1
}

# Un specifier qui ne commence ni par « . » ni par « / » est un nom de paquet.
if grep -Eq "Cannot find module '[^./]" "$LOG"; then
  fail "dépendance absente de l'arbre de production (voir « Cannot find module » ci-dessous).
Le paquet est importé par le code mais n'est pas déclaré dans apps/api/package.json :
il n'est là qu'en transitif, et pnpm ne le lie pas. Ajoutez-le aux dependencies."
fi

# Sans ce repère, un plantage plus précoce (et d'une autre nature) passerait
# pour un succès : aucune ligne fautive à repérer, donc aucun motif à trouver.
if ! grep -q 'Starting Nest application' "$LOG"; then
  fail "l'api n'a pas atteint le démarrage de Nest."
fi

echo "SMOKE BOOT: ok — modules chargés, Nest démarré."
