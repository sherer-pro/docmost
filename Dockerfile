# syntax=docker/dockerfile:1.6@sha256:ac85f380a63b13dfcefa89046420e1781752bab202122f8f50032edf31be0021

FROM node:22-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS node-base
LABEL org.opencontainers.image.source="https://github.com/sherer-pro/docmost"

FROM node-base AS build-base

RUN npm install -g pnpm@10.4.0

FROM build-base AS builder

WORKDIR /app

# 1) Copy only dependency-defining files first to maximize layer cache reuse.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY patches ./patches
COPY apps/*/package.json ./apps/
COPY packages/*/package.json ./packages/

# 2) Installation mode:
#    - PNPM_OFFLINE=1 (default): install from cache without network access
#    - PNPM_OFFLINE=0: allow network access in CI/production
ARG PNPM_OFFLINE=1

# 3) Pre-populate pnpm store (downloads only when cache is missing).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm fetch --frozen-lockfile

# 4) Copy source files.
COPY . .

# 5) Install dependencies (offline locally, online in production/CI).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    if [ "$PNPM_OFFLINE" = "1" ]; then \
      pnpm install --frozen-lockfile --offline; \
    else \
      pnpm install --frozen-lockfile; \
    fi

# 6) Build.
RUN pnpm build

FROM build-base AS runtime-dependencies

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY patches ./patches
COPY apps/server/package.json ./apps/server/package.json
COPY packages/editor-ext/package.json ./packages/editor-ext/package.json
COPY packages/api-contract/package.json ./packages/api-contract/package.json

ARG PNPM_OFFLINE=1

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    if [ "$PNPM_OFFLINE" = "1" ]; then \
      pnpm install --frozen-lockfile --prod --offline; \
    else \
      pnpm install --frozen-lockfile --prod; \
    fi

FROM node-base AS installer

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    chromium \
    curl \
    fonts-dejavu-core \
    fonts-liberation \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV PDF_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
ENV PDF_RENDER_TIMEOUT_MS=60000
ENV NODE_ENV=production

# Copy apps
COPY --chown=node:node --from=builder /app/apps/server/dist /app/apps/server/dist
COPY --chown=node:node --from=builder /app/apps/client/dist /app/apps/client/dist
COPY --chown=node:node --from=builder /app/apps/server/package.json /app/apps/server/package.json
COPY --chown=node:node --from=runtime-dependencies /app/apps/server/node_modules /app/apps/server/node_modules

# Copy packages
COPY --chown=node:node --from=builder /app/packages/editor-ext/dist /app/packages/editor-ext/dist
COPY --chown=node:node --from=builder /app/packages/editor-ext/package.json /app/packages/editor-ext/package.json
COPY --chown=node:node --from=builder /app/packages/api-contract/dist /app/packages/api-contract/dist
COPY --chown=node:node --from=builder /app/packages/api-contract/package.json /app/packages/api-contract/package.json

# Copy production dependencies without carrying package-manager tooling into runtime.
COPY --chown=node:node --from=runtime-dependencies /app/node_modules /app/node_modules

RUN find /app/apps /app/packages -type f \( -name '*.map' -o -name '*.d.ts' \) -delete \
  && find /app/node_modules -type f \( -name '.env' -o -name '.env.*' \) -delete

RUN rm -rf \
      /usr/local/lib/node_modules/npm \
      /usr/local/lib/node_modules/corepack \
  && rm -f \
      /usr/local/bin/npm \
      /usr/local/bin/npx \
      /usr/local/bin/corepack \
      /usr/local/bin/pnpm \
      /usr/local/bin/pnpx \
      /usr/local/bin/yarn \
      /usr/local/bin/yarnpkg

RUN mkdir -p /app/data/storage && chown -R node:node /app/data

USER node

VOLUME ["/app/data/storage"]

EXPOSE 3000

CMD ["node", "apps/server/dist/apps/server/src/main"]
