# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS build

WORKDIR /app
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable
COPY agent-console/package.json agent-console/pnpm-lock.yaml ./
RUN --mount=type=cache,id=buildwatch-frontend-corepack,target=/root/.cache/node/corepack \
    --mount=type=cache,id=buildwatch-frontend-pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm config set fetch-retries 5 \
    && pnpm config set fetch-retry-mintimeout 10000 \
    && pnpm config set fetch-retry-maxtimeout 120000 \
    && pnpm config set fetch-timeout 600000 \
    && pnpm config set network-concurrency 4 \
    && pnpm install --frozen-lockfile --config.package-import-method=copy
COPY agent-console ./
RUN ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vite build

FROM nginxinc/nginx-unprivileged:1.28-alpine AS runtime
COPY agent-console/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/health/live"]
