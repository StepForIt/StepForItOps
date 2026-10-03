#!/bin/sh
# L'api compilée sur la base de démo : schéma poussé, parc fictif semé, puis servie.
# La base est VIDÉE : son nom doit finir par « _demo ».
set -e
: "${DATABASE_URL:?DATABASE_URL manquant (…/nwm_demo)}"
case "${DATABASE_URL%%\?*}" in
  *_demo) ;;
  *) echo "Base refusée : le mode démo la VIDE, son nom doit finir par « _demo »." >&2; exit 1 ;;
esac
cd "$(dirname "$0")/../../.."
. apps/demo/scripts/env.sh
pnpm --filter @nwm/api prisma:generate >/dev/null
pnpm --filter @nwm/api build
pnpm --filter @nwm/api exec prisma db push --skip-generate --accept-data-loss
node apps/demo/seed.mjs
# Aucune clé : l'IA est celle de démo (demo-ai.mjs), rien n'est facturé.
ANTHROPIC_API_KEY=cle-de-demo ANTHROPIC_BASE_URL="http://127.0.0.1:$DEMO_AI_PORT" \
  exec node apps/api/dist/apps/api/src/main.js
