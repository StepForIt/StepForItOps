#!/bin/sh
# La console en build de PRODUCTION, et non `next dev` : ni indicateur de compilation
# à l'écran, ni effets joués deux fois, ni page compilée à la première visite.
set -e
cd "$(dirname "$0")/../../.."
. apps/demo/scripts/env.sh
export API_INTERNAL_URL="http://127.0.0.1:$API_PORT"
pnpm --filter @nwm/web build
exec pnpm --filter @nwm/web exec next start -p "$WEB_PORT"
