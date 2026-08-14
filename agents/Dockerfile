# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS dependencies

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
WORKDIR /app

RUN apt-get -o Acquire::Retries=5 update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=buildwatch-corepack,target=/root/.cache/node/corepack \
    --mount=type=cache,id=buildwatch-pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm config set fetch-retries 5 \
    && pnpm config set fetch-retry-mintimeout 10000 \
    && pnpm config set fetch-retry-maxtimeout 120000 \
    && pnpm config set fetch-timeout 600000 \
    && pnpm config set network-concurrency 4 \
    && pnpm install --frozen-lockfile --config.package-import-method=copy

FROM dependencies AS build

COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json tsconfig.build.json ./
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public" \
    ./node_modules/.bin/prisma generate

COPY src ./src
COPY assets ./assets
RUN ./node_modules/.bin/tsc -p tsconfig.build.json
RUN mkdir -p dist/reporting/templates \
    && cp src/reporting/templates/project-report.hbs dist/reporting/templates/project-report.hbs

FROM build AS production-dependencies
RUN --mount=type=cache,id=buildwatch-corepack,target=/root/.cache/node/corepack \
    --mount=type=cache,id=buildwatch-pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm prune --prod --config.package-import-method=copy

FROM postgres:16-bookworm AS pg16-client-repository

FROM node:22-bookworm-slim AS runtime-system

ENV NODE_ENV=production
WORKDIR /app

RUN --mount=type=cache,id=buildwatch-apt-lists,target=/var/lib/apt/lists,sharing=locked \
    --mount=type=cache,id=buildwatch-apt-cache,target=/var/cache/apt,sharing=locked \
    apt-get -o Acquire::Retries=5 update \
    && apt-get -o Acquire::Retries=5 -o APT::Keep-Downloaded-Packages=true install -y --no-install-recommends \
      ca-certificates \
      openssl

FROM runtime-system AS runtime-browser-system

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_DISABLE_SANDBOX=true

RUN --mount=type=cache,id=buildwatch-apt-lists,target=/var/lib/apt/lists,sharing=locked \
    --mount=type=cache,id=buildwatch-apt-cache,target=/var/cache/apt,sharing=locked \
    apt-get -o Acquire::Retries=5 update \
    && apt-get -o Acquire::Retries=5 -o APT::Keep-Downloaded-Packages=true install -y --no-install-recommends \
      chromium \
      chromium-sandbox \
      fonts-noto-core

USER node

FROM runtime-system AS runtime-core

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/assets ./assets
COPY --from=build --chown=node:node /app/package.json ./

RUN mkdir -p /app/data/artifacts /app/data/feedback \
    && chown -R node:node /app/data

USER node

FROM runtime-browser-system AS runtime-base

COPY --from=runtime-core --chown=node:node /app /app

USER node

FROM runtime-base AS api
EXPOSE 4180
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4180/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/scripts/phase9-server.js"]

FROM runtime-core AS outbox-worker
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD ["node", "dist/scripts/health.js", "--ready"]
CMD ["node", "dist/scripts/phase9-outbox-worker.js"]

FROM runtime-base AS agent-worker
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD ["node", "dist/scripts/health.js", "--ready"]
CMD ["node", "dist/scripts/worker.js"]

FROM build AS migrate
ENV NODE_ENV=production
USER node
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]

FROM runtime-system AS operations-system

COPY --from=pg16-client-repository \
  /usr/local/share/keyrings/postgres.gpg.asc \
  /usr/local/share/keyrings/postgres.gpg.asc
RUN --mount=type=cache,id=buildwatch-apt-lists,target=/var/lib/apt/lists,sharing=locked \
    --mount=type=cache,id=buildwatch-apt-cache,target=/var/cache/apt,sharing=locked \
    echo "deb [signed-by=/usr/local/share/keyrings/postgres.gpg.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main 16" \
      > /etc/apt/sources.list.d/pgdg.list \
    && apt-get -o Acquire::Retries=5 update \
    && apt-get -o Acquire::Retries=5 -o APT::Keep-Downloaded-Packages=true install -y --no-install-recommends \
      postgresql-client-16 \
    && rm -f /etc/apt/sources.list.d/pgdg.list \
    && mkdir -p /backups \
    && chown node:node /backups
USER node

FROM operations-system AS operations

COPY --from=runtime-core --chown=node:node /app /app

USER node
CMD ["node", "dist/scripts/phase11-backup.js"]

FROM agent-worker AS runtime
