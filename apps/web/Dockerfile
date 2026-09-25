FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo
# Par défaut le front passe par son proxy /backend → API via le réseau Docker.
# NEXT_PUBLIC_API_URL ne sert que pour pointer une API distante directement.
ARG NEXT_PUBLIC_API_URL=
ARG API_INTERNAL_URL=http://api:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV API_INTERNAL_URL=$API_INTERNAL_URL
# Remontée des erreurs du front (Sentry / GlitchTip, cf. docs/sentry.md). Le
# préfixe NEXT_PUBLIC_ est inliné au build : posées au runtime, ces variables
# n'atteindraient jamais le navigateur.
ARG NEXT_PUBLIC_SENTRY_DSN=
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=
ARG NEXT_PUBLIC_SENTRY_RELEASE=
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_ENVIRONMENT=$NEXT_PUBLIC_SENTRY_ENVIRONMENT
ENV NEXT_PUBLIC_SENTRY_RELEASE=$NEXT_PUBLIC_SENTRY_RELEASE
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
# Le store pnpm est un cache BuildKit : il survit d'un déploiement à l'autre,
# donc les paquets sont réutilisés au lieu d'être retéléchargés. Un `id` par
# image car api et web se construisent en parallèle.
RUN --mount=type=cache,id=pnpm-web,target=/pnpm/store \
    pnpm install --store-dir /pnpm/store --no-frozen-lockfile

# Dev : sources montées en bind mount (cf. docker-compose.override.yml),
# hot reload via `next dev` (Fast Refresh).
FROM deps AS dev
ENV NODE_ENV=development
EXPOSE 3000
CMD ["sh", "-c", "cd apps/web && ./node_modules/.bin/next dev -p 3000 -H 0.0.0.0"]

FROM deps AS build
# .next/cache = cache de compilation Next (webpack + SWC). En cache BuildKit,
# un déploiement ne recompile que ce qui a changé.
RUN --mount=type=cache,id=next-web,target=/repo/apps/web/.next/cache \
    pnpm --filter @nwm/web build

# Prod (stage final = target par défaut de `docker build`)
# Sortie `standalone` : Next trace les fichiers réellement nécessaires au
# serveur. On n'embarque plus les node_modules complets du monorepo (dev
# dependencies incluses) → image ~10x plus petite, export et déploiement d'autant.
FROM node:20-alpine
WORKDIR /repo
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
# `standalone` ne trace pas public/ : sans cette copie, manifeste, icônes et
# service worker manquent en prod et l'app n'est plus installable.
COPY --from=build /repo/apps/web/public ./apps/web/public
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000
# Serveur autonome généré par le build : ni pnpm ni next CLI au runtime.
CMD ["node", "apps/web/server.js"]
