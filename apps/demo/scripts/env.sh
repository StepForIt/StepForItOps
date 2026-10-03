# Les ports et identifiants du mode démo, lus par api.sh, web.sh et stack.sh.
# Le vocabulaire du studio vidéo (studio/product.ts) s'y connecte avec les mêmes :
# les changer ici, c'est les changer là-bas.
export API_PORT="${API_PORT:-3021}" WEB_PORT="${WEB_PORT:-3020}"
export DEMO_N8N_PORT="${DEMO_N8N_PORT:-3922}" DEMO_AI_PORT="${DEMO_AI_PORT:-3923}"
export API_ACCESS_TOKEN=jeton-de-la-demo
export APP_USERNAME=demo APP_PASSWORD=demo-promo SESSION_SECRET=secret-de-la-demo
# Clé de démo, publique à dessein : sans elle la bannière « secrets en clair » entrerait dans le champ.
export SECRETS_KEY=ZGVtby1kZW1vLWRlbW8tZGVtby1kZW1vLWRlbW8tMzI=
# Un build à part : la démo ne réutilise ni n'écrase celui du dev.
export NEXT_DIST_DIR=.next-demo
