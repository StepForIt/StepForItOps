#!/bin/sh
# Tout le mode démo d'un coup, pour le montrer ou écrire une scène en le regardant :
#   DATABASE_URL=postgresql://nwm:nwm@localhost:55444/nwm_demo pnpm --filter @nwm/demo stack
# puis http://localhost:3020, demo / demo-promo.
set -e
cd "$(dirname "$0")/.."
trap 'kill 0' EXIT INT TERM
node demo-n8n.mjs &
node demo-ai.mjs &
sh scripts/api.sh &
sh scripts/web.sh &
wait
