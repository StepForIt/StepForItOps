#!/bin/sh
# Applique les migrations Prisma, puis rend la main. Ce script est le conteneur
# `migrate` : l'api ne démarre qu'une fois qu'il a terminé avec succès.
#
# Le cas particulier traité ici est la base **déjà peuplée sans historique** :
# jusqu'ici le schéma était appliqué par `prisma db push`, qui ne laisse aucune
# trace. Y lancer `migrate deploy` tel quel échouerait — la première migration
# voudrait créer des tables qui existent. On la déclare donc appliquée
# (baseline) avant de dérouler la suite.
#
# La distinction se fait sur le contenu réel de la base, pas sur un drapeau :
# - une table connue répond   → base existante  → baseline puis deploy
# - elle n'existe pas         → base neuve      → deploy crée tout
set -e
cd "$(dirname "$0")/.."
PRISMA="./node_modules/.bin/prisma"
BASELINE=0_init

if echo 'SELECT 1 FROM "Workflow" LIMIT 1;' | "$PRISMA" db execute --stdin --schema prisma/schema.prisma >/dev/null 2>&1; then
  # Échoue si la baseline est déjà enregistrée (déploiements suivants) : sans conséquence.
  "$PRISMA" migrate resolve --applied "$BASELINE" 2>/dev/null || true
fi

"$PRISMA" migrate deploy

# Les migrations sont passées : la base doit maintenant être exactement le
# schéma. Si elle ne l'est pas, c'est qu'une modification de schema.prisma est
# partie sans sa migration — en dev le `db push` de l'api l'avait appliquée en
# silence, et rien ne l'aurait signalé avant qu'une requête ne casse ici.
#
# On compare la base réelle au schéma (pas les migrations au schéma, qui
# demanderait une shadow database). `--exit-code` : 0 = identiques, 2 = écart.
if ! "$PRISMA" migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code >/tmp/schema-drift.sql 2>&1; then
  echo "──────────────────────────────────────────────────────────────"
  echo "ÉCART entre la base migrée et schema.prisma."
  echo "Il manque une migration : crée-la (pnpm --filter @nwm/api prisma:migrate)"
  echo "et redéploie. Ce qu'il faudrait appliquer pour combler l'écart :"
  echo "──────────────────────────────────────────────────────────────"
  cat /tmp/schema-drift.sql
  exit 1
fi
