#!/bin/sh
# Vérifie qu'une modification de schema.prisma est bien partie avec sa migration.
# À jouer avant de pousser : c'est ce que le déploiement refusera sinon.
#
# Ce qui est comparé, ce sont les **migrations** au schéma — surtout pas la base
# de dev au schéma : l'api la maintient alignée par `db push`, cette
# comparaison-là serait verte quoi qu'il arrive.
#
# Rejouer les migrations demande une base jetable (shadow database) : Prisma y
# déroule le dossier migrations/ pour savoir ce qu'il produit, puis la vide. On
# prend le postgres de docker-compose, en s'appuyant sur DATABASE_URL pour
# construire l'URL d'une base voisine.
set -e
cd "$(dirname "$0")/.."

# Prisma charge .env tout seul pour les commandes à schéma ; ici on lit l'URL
# nous-mêmes, il faut donc reprendre le même fichier.
if [ -z "$DATABASE_URL" ] && [ -f ../../.env ]; then
  DATABASE_URL=$(grep -E '^DATABASE_URL=' ../../.env | head -1 | cut -d= -f2-)
fi

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL introuvable (ni dans l'environnement, ni dans .env à la racine)."
  echo "Exemple : DATABASE_URL=postgresql://nwm:nwm@localhost:5432/nwm ./scripts/check-schema.sh"
  exit 1
fi

# Même serveur, autre base : `.../nwm?schema=public` → `.../nwm_shadow`
SERVER=${DATABASE_URL%/*}
SHADOW="$SERVER/nwm_shadow"
PRISMA="./node_modules/.bin/prisma"

# Prisma veut que la shadow database existe déjà : il la vide et la remplit,
# il ne la crée pas. On la crée une fois, elle resservira.
SHADOW_NAME=${SHADOW##*/}
echo "CREATE DATABASE \"$SHADOW_NAME\";" \
  | "$PRISMA" db execute --url "$SERVER/postgres" --stdin >/dev/null 2>&1 || true

echo "Rejeu des migrations dans une base jetable…"
set +e
"$PRISMA" migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$SHADOW" \
  --exit-code
STATUS=$?
set -e

# --exit-code : 0 = identiques, 2 = écart, 1 = la commande elle-même a échoué.
# Les distinguer, sinon un postgres éteint se lit « migration manquante ».
case "$STATUS" in
  0) echo "OK : les migrations produisent exactement schema.prisma." ;;
  2)
    echo
    echo "Ton schema.prisma n'est pas couvert par les migrations (écart ci-dessus)."
    echo "Crée la migration manquante :  pnpm --filter @nwm/api prisma:migrate"
    exit 1
    ;;
  *)
    echo
    echo "Contrôle impossible (erreur ci-dessus) — postgres est-il lancé ?"
    echo "Shadow database utilisée : $SHADOW"
    exit 1
    ;;
esac
