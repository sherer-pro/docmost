# syntax=docker/dockerfile:1.6

FROM node:22-slim AS base
LABEL org.opencontainers.image.source="https://github.com/docmost/docmost"

RUN npm install -g pnpm@10.4.0

FROM base AS builder

WORKDIR /app

# 1) Сначала копируем только то, что влияет на зависимости (чтобы работал кэш слоёв)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY patches ./patches
COPY apps/*/package.json ./apps/
COPY packages/*/package.json ./packages/

# 2) Управление режимом установки:
#    - PNPM_OFFLINE=1 (по умолчанию): локально ставим оффлайн из кэша (не скачиваем заново)
#    - PNPM_OFFLINE=0: для CI/прода разрешаем сеть (может скачивать)
ARG PNPM_OFFLINE=1

# 3) Сначала "накачиваем" store (может качать только при отсутствии в кэше)
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm fetch --frozen-lockfile

# 4) Теперь копируем исходники
COPY . .

# 5) Установка зависимостей (оффлайн локально, онлайн в проде/CI)
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    if [ "$PNPM_OFFLINE" = "1" ]; then \
      pnpm install --frozen-lockfile --offline; \
    else \
      pnpm install --frozen-lockfile; \
    fi

# 6) Билд
RUN pnpm build

FROM base AS installer

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl bash \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

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

# Режим установки для runtime-слоя (тот же переключатель)
ARG PNPM_OFFLINE=1

# Runtime-зависимости (prod). Локально оффлайн из кэша, в проде/CI можно онлайн.
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
