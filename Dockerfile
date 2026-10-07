# syntax=docker/dockerfile:1.7
# Fleisch-Teufel: one image serving API + PWA on port 3000.

# ---------------------------------------------------------------- build
FROM node:22-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true
RUN corepack enable
WORKDIR /app

# Dependency layer (cached until a manifest or the lockfile changes).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY tools/bls-import/package.json tools/bls-import/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

COPY . .
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
RUN pnpm --filter @ft/web build && pnpm --filter @ft/api build

# ---------------------------------------------------------------- runtime
FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
WORKDIR /app
# The only runtime dependency not bundled by esbuild: the native Argon2 binding (musl build).
RUN npm install --omit=dev --no-audit --no-fund --no-save @node-rs/argon2@2.2.2 && npm cache clean --force
COPY --from=build /app/apps/api/dist ./
COPY --from=build /app/apps/web/dist ./public
ARG APP_VERSION=dev
LABEL org.opencontainers.image.title="Fleisch-Teufel" \
      org.opencontainers.image.description="Offline-first nutrition tracker PWA with self-hosted sync" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${APP_VERSION}"
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1
CMD ["node", "--enable-source-maps", "server.js"]
