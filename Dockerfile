# syntax=docker/dockerfile:1.6

FROM node:22-slim AS base
LABEL org.opencontainers.image.source="https://github.com/sherer-pro/docmost"

RUN npm install -g pnpm@10.4.0

FROM base AS builder

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

FROM base AS installer

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

# Copy apps
COPY --from=builder /app/apps/server/dist /app/apps/server/dist
COPY --from=builder /app/apps/client/dist /app/apps/client/dist
COPY --from=builder /app/apps/server/package.json /app/apps/server/package.json

# Copy packages
COPY --from=builder /app/packages/editor-ext/dist /app/packages/editor-ext/dist
COPY --from=builder /app/packages/editor-ext/package.json /app/packages/editor-ext/package.json

# Copy root package files
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/pnpm-lock.yaml /app/pnpm-lock.yaml
COPY --from=builder /app/pnpm-workspace.yaml /app/pnpm-workspace.yaml
COPY --from=builder /app/.npmrc /app/.npmrc

# Copy patches
COPY --from=builder /app/patches /app/patches

RUN chown -R node:node /app

USER node

# Installation mode for runtime layer (same switch).
ARG PNPM_OFFLINE=1

# Runtime dependencies (prod). Offline from cache locally, online in production/CI.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    if [ "$PNPM_OFFLINE" = "1" ]; then \
      pnpm install --frozen-lockfile --prod --offline; \
    else \
      pnpm install --frozen-lockfile --prod; \
    fi

RUN mkdir -p /app/data/storage

VOLUME ["/app/data/storage"]

EXPOSE 3000

CMD ["pnpm", "start"]
