# AGENTS.md — практическая шпаргалка по автоматизации в `docmost`

> Цель: дать агенту/разработчику минимум контекста, чтобы **сразу выполнять задачи без уточняющих вопросов**. Ниже только прикладные шаги, подтверждённые текущим кодом и конфигами.

## 0) Быстрый профиль репозитория

- Монорепозиторий на **pnpm workspaces** + **Nx**.
- Основные приложения:
  - `apps/server` — NestJS backend.
  - `apps/client` — Vite + React frontend.
  - `packages/editor-ext` — shared TS-пакет расширений редактора.
- Корневой пакетный менеджер зафиксирован: `pnpm@10.4.0`.
- Для прод-образа используется `node:22-slim`.

---

## 1) Навигация по коду

### Точки входа

- Локальная fullstack-разработка: `pnpm dev` (параллельно frontend + backend).
- Backend dev: `pnpm server:dev`.
- Frontend dev: `pnpm client:dev`.
- Прод-запуск собранного backend: `pnpm start` (корневой script → `apps/server start:prod`).
- Realtime collab-сервер: `pnpm collab` / `pnpm collab:dev`.
- Email templates preview (backend): `pnpm email:dev`.

### Где что лежит

- `apps/server/src` — основной backend-код.
- `apps/client/src` — основной frontend-код.
- `apps/client/public/locales/*` — JSON-переводы.
- `apps/server/src/database` — миграции и DB tooling.
- `patches/` — pnpm patch-файлы (например, для `react-arborist`).
- `packages/ee`, `apps/*/src/ee` — Enterprise-код (отдельная лицензия).

### Что можно безопасно игнорировать при анализе

- `node_modules/`
- `apps/*/dist`, `packages/*/dist`, корневой `/dist`
- `.nx/`, `coverage/`, логи (`*.log`)
- `data/` (локальные runtime-данные)

---

## 2) Повторяемые команды (runbook)

### Установка и базовая проверка

- Установка зависимостей: `pnpm install --frozen-lockfile`
- Сборка всего монорепо: `pnpm build`
- Очистка артефактов: `pnpm clean`

### Разработка

- Fullstack dev: `pnpm dev`
- Только backend: `pnpm server:dev`
- Только frontend: `pnpm client:dev`
- Локальный preview frontend-сборки: `pnpm --filter ./apps/client preview`

### Линтинг и форматирование

- Backend lint (с автофиксами): `pnpm --filter ./apps/server lint`
- Frontend lint: `pnpm --filter ./apps/client lint`
- Backend format: `pnpm --filter ./apps/server format`
- Frontend format: `pnpm --filter ./apps/client format`
- Check comments language (server/client src): `pnpm check:comments:en`

### Тесты

- Backend unit/integration: `pnpm --filter ./apps/server test`
- Backend coverage: `pnpm --filter ./apps/server test:cov`
- Backend coverage smoke (быстрый регресс-чек): `pnpm --filter ./apps/server test:cov:smoke`
- Backend alias smoke (проверка резолва tsconfig aliases в Jest): `pnpm --filter ./apps/server test:alias:smoke`
- Backend e2e: `pnpm --filter ./apps/server test:e2e`

### Миграции БД (backend)

- Создать миграцию: `pnpm --filter ./apps/server migration:create`
- Применить: `pnpm --filter ./apps/server migration:up`
- Откатить 1 шаг: `pnpm --filter ./apps/server migration:down`
- Применить до latest: `pnpm --filter ./apps/server migration:latest`
- Redo: `pnpm --filter ./apps/server migration:redo`
- Полный reset: `pnpm --filter ./apps/server migration:reset`
- Генерация DB-типов: `pnpm --filter ./apps/server migration:codegen`

### Контейнеры

- Локальный контейнерный старт (готовый образ): `docker compose up -d`
- Сборка текущего кода в образ: `docker build -t docmost:local .`

> Для миграций, запуска backend и части интеграционных функций обязательно заданы `DATABASE_URL`, `REDIS_URL`, `APP_SECRET` (см. `.env.example`).

---

## 3) Соглашения о стиле (фактические)

### TypeScript/JS стиль

- Prettier в backend/editor-ext: `singleQuote: true`, `trailingComma: all`.
- В frontend встречается стиль с двойными кавычками (конфиг ESLint/код), принудительного единообразия кавычек на уровне shared root-конфига нет — **не делать массовых стилевых правок без запроса**.
- Отступы в кодовой базе — пробелы (обычно 2).

### ESLint-практика

- И в backend, и в frontend явно ослаблены ряд строгих TS-правил (`no-explicit-any`, `no-unused-vars`, `ban-ts-comment` отключены).
- Backend lint запускается с `--fix`; перед коммитом полезно прогонять lint в затронутом приложении.
- Комментарии в коде писать только на английском (ASCII), без кириллицы.

### Формат сообщений коммитов (по истории)

- Преобладает Conventional Commits-подобный стиль: `feat(...)`, `fix(...)`, `docs: ...`.
- Допустимы merge-коммиты от PR.

---

## 4) Ограничения и переменные среды

### Минимальные версии/рантаймы

- Node.js: ориентир **22.x** (из Dockerfile: `node:22-slim`).
- pnpm: **10.4.0** (зафиксировано в `packageManager` и Dockerfile).
- PostgreSQL в compose: `postgres:18`.
- Redis в compose: `redis:8`.

### Обязательные env для локального запуска backend

Минимум:

- `APP_URL` (обычно `http://localhost:3000`)
- `PORT` (по умолчанию 3000)
- `APP_SECRET` (минимум 32 символа)
- `DATABASE_URL`
- `REDIS_URL`

### Часто используемые опциональные env

- Storage: `STORAGE_DRIVER`, `AWS_S3_*`
- Mail: `MAIL_DRIVER`, `SMTP_*`, `POSTMARK_TOKEN`
- Диагностика: `DEBUG_MODE`, `DEBUG_DB`, `LOG_HTTP`
- Frontend runtime define: `COLLAB_URL`, `SUBDOMAIN_HOST`, `POSTHOG_*`, `BILLING_TRIAL_DAYS` и др. (подхватываются через `vite loadEnv`).

---

## 5) Зависимости и менеджеры пакетов

- Основной менеджер: **pnpm** (workspace).
- Оркестрация задач монорепо: **Nx** (`nx run ...`, `nx run-many ...`).
- Обновления зависимостей: через `pnpm up` (точечно по пакету или workspace).
- Security/audit:
  - базово: `pnpm audit`
  - дополнительно учитывать `pnpm.overrides` в корневом `package.json` (используются для фикса версий уязвимых/конфликтных пакетов).
- Патчи зависимостей: хранить и поддерживать в `patches/` и секции `pnpm.patchedDependencies`.

---

## 6) CI/CD и как воспроизвести локально

- В репозитории **нет** директории `.github/workflows` или другого явного CI-манифеста.
- Де-факто обязательный локальный пайплайн перед PR:
  1. `pnpm install --frozen-lockfile`
  2. `pnpm build`
  3. lint/test только для затронутых частей (`apps/server`, `apps/client`).
  4. при изменениях инфраструктуры — `docker build` и/или `docker compose up` smoke-check.

---

## 7) Расхождения и подводные камни

- Для всех mutating API-методов (POST/PUT/PATCH/DELETE) действует глобальная CSRF-проверка (double-submit cookie): требуется совпадение `csrfToken` cookie и заголовка `x-csrf-token`.
- Исключения CSRF по архитектуре: `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/forgot-password`, `POST /api/auth/password-reset`, `POST /api/auth/verify-token`, `POST /api/auth/setup`.
- Root-скрипт `start` запускает **backend prod**, но требует заранее собранные `dist` (обычно через `pnpm build`).
- В compose используются placeholders (`REPLACE_WITH_LONG_SECRET`, `STRONG_DB_PASSWORD`) — не забывать заменять.
- `migration:codegen` читает env из `../../.env`; при отсутствии файла команда падает.
- Есть Enterprise-области (`*/ee`): правки там могут затрагивать лицензионно-ограниченный код.
- В репозитории есть lock/override/patched-зависимости — не удалять «лишние» фиксации без проверки.

---

## 8) Полезные внешние ссылки

- Основная документация: https://docmost.com/docs
- Development-раздел (упомянут в README): https://docmost.com/docs/self-hosting/development
- Локализация (платформа): https://crowdin.com/
- i18next backend docs (по текущему стеку): https://github.com/i18next/i18next-http-backend

---

## 9) Локализация (переводы)

- Источник переводов UI: `apps/client/public/locales/<locale>/translation.json`.
- Базовая локаль и fallback: `en-US`.
- Конфиг синхронизации с Crowdin: `crowdin.yml` (source = `en-US/translation.json`, target = `%locale%`).
- При добавлении новых пользовательских строк:
  1. обновить `en-US/translation.json`;
  2. добавить ключи в остальные локали (минимум stub/копия, если процесс перевода внешний);
  3. проверить, что ключи используются через `react-i18next` (`useTranslation`).

---

## 10) Правило актуализации этого файла

**Обязательно обновляй `AGENTS.md` при любых изменениях, затрагивающих:**

- команды запуска/сборки/тестов/миграций;
- структуру каталогов и точки входа;
- линтеры/форматтеры/стилевые правила;
- обязательные env и версии рантаймов;
- CI/CD процесс или контейнерный сценарий;
- процесс локализации и пути хранения переводов.

Если изменение не отражено в `AGENTS.md`, задача по автоматизации считается незавершённой.
