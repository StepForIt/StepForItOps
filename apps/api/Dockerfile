# Node 22 et non 20 : l'import du catalogue de nœuds lit un SQLite avec le module
# natif `node:sqlite`, absent avant la 22. L'alternative (better-sqlite3) est un
# module natif, donc une chaîne de compilation dans l'image — pour un fichier lu
# une fois par semaine.
FROM node:22-alpine AS deps
RUN apk add --no-cache openssl && corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
# Le store pnpm est un cache BuildKit : il survit d'un déploiement à l'autre,
# donc les paquets sont réutilisés au lieu d'être retéléchargés. Un `id` par
# image car api et web se construisent en parallèle.
RUN --mount=type=cache,id=pnpm-api,target=/pnpm/store \
    pnpm install --store-dir /pnpm/store --no-frozen-lockfile
RUN pnpm --filter @nwm/api prisma:generate

# Dev : sources montées en bind mount (cf. docker-compose.override.yml),
# recompilation à chaud via `nest start --watch`. Prisma generate au boot
# pour qu'un simple restart prenne en compte un schema.prisma modifié.
FROM deps AS dev
ENV NODE_ENV=development
EXPOSE 3001
CMD ["sh", "-c", "cd apps/api && ./node_modules/.bin/prisma generate && ./node_modules/.bin/prisma db push --skip-generate && pnpm start:dev"]

FROM deps AS build
RUN pnpm --filter @nwm/api build

# Arbre de dépendances de production, sans les outils de build (typescript,
# nest-cli, webpack, vitest…). Ne copie QUE les package.json : cette couche ne
# dépend pas du code, elle reste donc en cache tant que les dépendances ne
# bougent pas. Un package ajouté à pnpm-workspace.yaml doit être listé ici,
# sinon `pnpm install` ne saura pas résoudre son `workspace:*`.
FROM node:22-alpine AS prod-deps
RUN apk add --no-cache openssl && corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/core/package.json ./packages/core/
COPY packages/adapters/anthropic/package.json ./packages/adapters/anthropic/
COPY packages/adapters/mistral/package.json ./packages/adapters/mistral/
COPY packages/adapters/docs/package.json ./packages/adapters/docs/
COPY packages/adapters/gdrive/package.json ./packages/adapters/gdrive/
COPY packages/adapters/github/package.json ./packages/adapters/github/
COPY packages/adapters/make-api/package.json ./packages/adapters/make-api/
COPY packages/adapters/n8n-api/package.json ./packages/adapters/n8n-api/
COPY packages/adapters/node-catalog/package.json ./packages/adapters/node-catalog/
COPY packages/adapters/model-pricing/package.json ./packages/adapters/model-pricing/
COPY packages/adapters/notify/package.json ./packages/adapters/notify/
COPY packages/adapters/uptime-kuma/package.json ./packages/adapters/uptime-kuma/
RUN --mount=type=cache,id=pnpm-api,target=/pnpm/store \
    pnpm install --prod --store-dir /pnpm/store --no-frozen-lockfile

# Prod (stage final = target par défaut de `docker build`)
# Couches ordonnées du plus stable au plus volatil : un déploiement qui ne
# change que du code ne réexporte et ne retélécharge que le `dist` (~2 Mo)
# au lieu des ~300 Mo de node_modules.
FROM node:22-alpine
# Requis par le moteur Prisma (linux-musl)
RUN apk add --no-cache openssl
WORKDIR /repo
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/apps/api/node_modules ./apps/api/node_modules
# Le client Prisma est généré ici, pas repris du stage de build : il doit viser
# l'arbre de production. Couche figée par le seul schema.prisma.
COPY apps/api/prisma ./apps/api/prisma
RUN cd apps/api && ./node_modules/.bin/prisma generate
# Le compilé embarque aussi packages/* (cf. tsconfig de l'api) ; les alias
# @nwm/* sont résolus vers dist au runtime par src/register-aliases.ts.
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
# Joué par le service `migrate`, pas par l'api (cf. docker-compose.yml)
COPY apps/api/scripts ./apps/api/scripts
ENV NODE_ENV=production
# Démarrage à blanc de l'image qu'on s'apprête à livrer : une dépendance
# importée mais non déclarée n'existe pas dans cet arbre `--prod`, et se voit
# ici plutôt qu'en production. Dernière couche : elle ne réinvalide rien.
RUN cd apps/api && ./scripts/smoke-boot.sh
EXPOSE 3001
# L'api ne touche plus au schéma : le conteneur `migrate` a terminé avant elle.
# Une api qui migre elle-même, c'est une migration jouée autant de fois qu'il y
# a de répliques, et un échec de migration qui se déguise en crash applicatif.
CMD ["sh", "-c", "cd apps/api && node dist/apps/api/src/main.js"]
