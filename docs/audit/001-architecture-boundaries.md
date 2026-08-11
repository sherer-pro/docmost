# ARC: Architecture and module boundaries audit

Date: 2026-08-12

Repository: `D:\DevProjects\docmost`

Audit base: `7df380d19ab50d1f88955cf442d3f98e4c29f82a` (`main`, 228 commits ahead of `origin/main` at audit start)

Status: approved plan implemented on 2026-08-12, locally verified and committed as `8d32f6dc`; no push, pull request, tag or release was created.

## 1. Scope and evidence boundary

Connected direction: architecture and module boundaries (`ARC`).

The audit reconstructed the implementation from source, runtime entrypoints, manifests, Nest module composition, package imports, queue and transaction call sites, and the available local runtime. `ARCHITECTURE.md` was used only after comparison with executable code.

Available:

- repository read access and command execution;
- Node.js `v24.16.0`, Corepack/pnpm `10.4.0`, local Nx `22.5.0`;
- Docker Engine `29.5.3` and Compose `v5.1.4`;
- running `docmost`, `collab`, PostgreSQL 18 and Redis 8 containers;
- local network access.

Unavailable or intentionally not used:

- no proof that the running `docmost-local:dev` image was built from the exact audit `HEAD`;
- the shared local database may contain existing data, so migrations, destructive operations and mutating E2E scenarios were not run;
- browser inspection was not required because no UX-family module is connected;
- external SaaS/provider systems, a clean GitHub runner and a production host were not exercised;
- host Node 24 differs from the declared production Node 22; the container runtime reports Node `v22.23.2`.

Pre-existing user-owned working-tree changes were preserved:

- `graphify-out/.graphify_labels.json`
- `graphify-out/GRAPH_REPORT.md`
- `graphify-out/graph.html`
- `graphify-out/graph.json`
- `graphify-out/manifest.json`

## 2. Sources and previous passes

Read and checked against implementation:

- `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md`;
- app/package README files;
- root `package.json`, workspace manifests, Nx/TypeScript/test/lint/static-analysis configuration;
- relevant previous reports: `docs/realtime-collaboration-audit-2026-08-09.md`, `docs/transactional-outbox-audit-2026-08-09.md`, `docs/ci-release-gates-graphify-g26-audit-2026-08-11.md`;
- current queue outbox runbook and the relevant source/tests.

Graphify was used only for navigation. The existing graph contained 14,741 nodes and 42,152 links; the query result was truncated, so every claim below was verified in source, configuration, a command, or the local runtime. Graphify output was not updated because the audit protocol allows only this journal file to change.

## 3. Reconstructed architecture

### 3.1 Repository and build graph

- pnpm/Nx monorepo with `apps/server`, `apps/client`, `packages/api-contract` and `packages/editor-ext`.
- `apps/server` is a NestJS application with two process entrypoints built from the same image: the main API/static/general-worker process and a collaboration process.
- `apps/client` is a feature-oriented Vite/React application.
- `packages/api-contract` is the shared API-facing contract package.
- `packages/editor-ext` is a shared Tiptap/ProseMirror package used by both client and server.

### 3.2 Backend composition and dependency direction

- `AppModule` composes database, environment, 30 core feature modules, Redis, collaboration, Socket.IO, queue workers, static serving, health, import/export, storage, mail, security and telemetry.
- `CollabAppModule` composes database, environment, the same `CollaborationModule`, queues without the general worker, storage, health, Redis and eventing.
- Controllers normally depend on feature services; feature services depend on repositories and integration services; Kysely repositories own repeated persistence access.
- The intended direction is `transport -> core service -> repository/integration`. Two confirmed repository imports point back into core implementation and violate that direction (ARC-02).
- Thirteen Nest modules are global. `DatabaseModule` alone globally exports 30 repositories plus readiness, so a significant part of the effective dependency graph is not visible in feature-module `imports` metadata (ARC-09).

### 3.3 Durable state, transactions and asynchronous work

- PostgreSQL is the durable source of truth for application data, AI runs and `queue_outbox`.
- Redis/BullMQ provides wake-up signals, worker queues, presence, collaboration leases and ephemeral coordination.
- Sampled invitation, page duplication, page-template sync, comment notification and immediate notification-email producers pass a mandatory `KyselyTransaction` into `QueueOutboxService`; the domain row and outbox row are written inside the same transaction, and the BullMQ kick happens after commit.
- Focused outbox tests passed 23 tests. No ARC defect was found in the sampled transaction placement. Delivery semantics, concurrency and data-integrity guarantees remain owned by DAT and were not re-audited here.

### 3.4 External and trust boundaries

- HTTP/JWT/CSRF, API-key-only RAG/MCP, collaboration tokens, page ACL and space policies form the inbound trust boundaries.
- Storage, mail, search, AI/retrieval/MCP providers and Open WebUI sync are adapter-style integration contours configured through environment and per-space policy.
- Provider credentials are resolved in server-side services; this pass found no direct domain-to-vendor import severe enough for an ARC finding.
- The server consumes editor utilities through the package root; the compiled CommonJS barrel eagerly loads UI/editor modules and React dependencies in Node (ARC-05).

## 4. Coverage

| Part of system                | Direction   | Checked with                                                                                     | Not checked                                                         |
| ----------------------------- | ----------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Workspace/build graph         | ARC         | manifests, Nx scripts, tsconfig paths, dependency-cruiser JSON                                   | clean install on another OS                                         |
| Nest composition              | ARC         | `AppModule`, `CoreModule`, `CollabAppModule`, global-module inventory                            | every provider constructor in 30 core modules                       |
| Core-to-persistence direction | ARC         | all `apps/server/src/database/**` imports to `core/**`; representative service/repository flows  | full semantic classification of every query helper                  |
| Transaction boundaries        | ARC partial | five outbox producer contours, repository/service signatures, focused Jest                       | real DB fault injection; DAT-owned isolation/concurrency proof      |
| Queue/background composition  | ARC         | `QueueModule`, outbox dispatch, main/collab process registrations                                | long-running recovery and multi-worker load                         |
| Collaboration runtime         | ARC         | both entrypoint modules, Compose, client URL selection, WebSocket upgrade on ports 3000 and 3001 | exact-HEAD image; authenticated multi-instance editing in this pass |
| Shared packages               | ARC         | package manifests, Knip, import inventory, Node 22 require probe                                 | clean isolated publication/install of private packages              |
| Large application services    | ARC         | line/method/responsibility inventory of page-template, database and export services              | change-frequency/history and ownership metrics                      |
| External integrations         | ARC         | module layout, configuration and representative provider boundaries                              | live SMTP/S3/Typesense/Open WebUI/AI providers                      |
| Runtime/deployment            | ARC         | Compose topology, container health, Node version, process endpoints                              | production proxy/TLS/backup/restore/host orchestration              |

## 5. Commands and actual results

| Command/check                                                                                                                                     | Result                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git status --short --branch`, `git rev-parse HEAD`                                                                                               | `main`, ahead 228; only five pre-existing `graphify-out/*` modifications before journal creation                                                                    |
| `graphify query "architecture module service controller repository database queue worker integration provider boundary dependency" --budget 5000` | navigation candidates returned; 118/301 nodes in the truncated result; not used as proof                                                                            |
| `corepack pnpm run check:architecture`                                                                                                            | exit 0: 2,605 modules, 5,754 dependencies, 0 reported violations                                                                                                    |
| dependency-cruiser JSON inspection with the same scope/config                                                                                     | 2,730 dependencies have `couldNotResolve=true`: 1,954 `@/*`, 631 `@docmost/db*`, 10 other `@docmost/*`; reported violations remain 0                                |
| `corepack pnpm exec knip`                                                                                                                         | non-zero: 2 unused dependencies, 8 unused devDependencies, 31 unlisted dependencies, 6 unlisted binaries, 159 unused exports, 29 duplicate exports, 14 config hints |
| `corepack pnpm exec jscpd ...`                                                                                                                    | non-zero at configured zero threshold: 19 clones, 578 duplicated lines, 0.27%; DUP-owned and recorded only as outside scope                                         |
| `corepack pnpm run check:no-ee`                                                                                                                   | exit 0                                                                                                                                                              |
| `corepack pnpm run test:no-ee`                                                                                                                    | exit 0, 9/9 tests                                                                                                                                                   |
| `corepack pnpm run check:env`                                                                                                                     | exit 0, 5/5 contract tests and key-sync check passed                                                                                                                |
| `corepack pnpm run check:release-gates`                                                                                                           | exit 0, 60/60 tests                                                                                                                                                 |
| focused Jest: `jwt.strategy.spec.ts` + `queue-outbox.service.spec.ts`                                                                             | exit 0, 2 suites and 26 tests passed                                                                                                                                |
| `GET http://localhost:3000/api/health` and `GET http://localhost:3001/api/health`                                                                 | both HTTP 200 in the existing runtime                                                                                                                               |
| WebSocket open probe to `/collab` on ports 3000 and 3001                                                                                          | both completed the upgrade (`upgrade-open`)                                                                                                                         |
| Node 22 probe: `require('/app/packages/editor-ext/dist')`                                                                                         | 887 modules loaded; React, `@tiptap/react` and `@floating-ui` were all loaded                                                                                       |

During the read-only audit phase, full `verify:quick`, `verify:full` and `verify:release` were not rerun: they contain build/lint/browser stages outside that phase; server lint is configured with autofix, and the user had not yet authorized production changes. Post-approval implementation evidence is recorded in section 11. Prior G26 results were treated as historical evidence, not current confirmation.

## 6. Findings summary

| ID     | Direction | Status      | Severity | Priority | Size | Summary                                                                                                                                                                                           | Evidence labels                   |
| ------ | --------- | ----------- | -------- | -------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| ARC-01 | ARC       | defect      | medium   | P1       | S    | The blocking architecture gate reports zero violations while 2,730 internal dependencies are unresolved, so it cannot substantiate its cycle/boundary claim.                                      | `[config]` `[command]`            |
| ARC-02 | ARC       | defect      | low      | P1       | S    | Persistence repositories import a transport DTO enum and a core feature utility, reversing the declared dependency direction.                                                                     | `[code]`                          |
| ARC-03 | ARC       | risk        | medium   | P1       | M    | Authentication and outbox dispatch obtain required handlers through `ModuleRef.get(..., {strict:false})`; missing wiring is detected only on a request/job path.                                  | `[code]` `[command]`              |
| ARC-04 | ARC       | defect      | medium   | P1       | M    | Workspace dependency ownership is false: `packages/editor-ext` declares no dependencies and root/server/client scripts rely on hoisted undeclared packages.                                       | `[config]` `[command]`            |
| ARC-05 | ARC       | risk        | medium   | P1       | M    | Server imports from the editor package root; its compiled CommonJS barrel eagerly loads 887 modules including React/UI-only editor code under Node 22.                                            | `[code]` `[command]`              |
| ARC-06 | ARC       | risk        | medium   | P1       | M/L  | Main API and dedicated collab process both host `/collab`; production Compose therefore has two collaboration-capable processes with no explicit runtime-role boundary.                           | `[code]` `[config]` `[interface]` |
| ARC-07 | ARC       | risk        | low      | P2       | S    | Database and migration providers call `process.exit(1)` below the bootstrap boundary, bypassing normal Nest shutdown and central error policy.                                                    | `[code]`                          |
| ARC-08 | ARC       | risk        | medium   | P2       | L    | Page-template and database application services combine lifecycle, migration/recovery, authorization, export/rendering and queue orchestration responsibilities in single 3.2k-3.4k-line classes. | `[code]` `[command]`              |
| ARC-09 | ARC       | improvement | low      | P3       | L    | Thirteen global modules, especially the globally exported repository catalog, make feature dependencies implicit; current operation is valid but future boundary enforcement is weak.             | `[code]` `[command]`              |

No critical or high-severity ARC findings were confirmed, so detailed critical/high cards are not applicable.

## 7. Finding evidence and remediation direction

### ARC-01 - architecture gate loses internal edges

Evidence and reproduction:

- `[config] .dependency-cruiser.cjs:2-46` defines cycle/server-client rules and extensions but no TypeScript configuration for path aliases.
- `[config] apps/client/tsconfig.json:25-30` and `apps/server/tsconfig.json:22-43` define `@/*`, `@docmost/db/*` and other workspace paths.
- `[command] corepack pnpm run check:architecture` reports zero violations.
- `[command]` inspection of the same JSON report counts 2,730 unresolved dependencies out of 5,754, including 2,595 internal alias references.

Impact: a new cycle or forbidden dependency expressed through the normal aliases can pass the blocking `verify:*` gate. The finding is about false confidence in the control; this pass does not claim that a hidden cycle currently exists.

Root cause: dependency-cruiser is not configured with a tsconfig that represents all workspace aliases, and the gate has no fail-on-unresolved internal-edge assertion.

Remediation direction: add an aggregate architecture-only tsconfig or equivalent resolver configuration, then make unresolved imports matching repository-owned aliases a blocking error. Preserve external optional-module handling explicitly. Add a regression fixture that proves an alias-based cycle and server/client crossing fail.

### ARC-02 - repository imports core/transport implementation

Evidence:

- `[code] apps/server/src/database/repos/group/group.repo.ts:13,105-117` imports `DefaultGroup` from `core/group/dto/create-group.dto.ts`.
- `[code] apps/server/src/core/group/dto/create-group.dto.ts:12-33` combines transport validation with the enum consumed by persistence.
- `[code] apps/server/src/database/repos/label/label.repo.ts:10,38-75` imports normalization from `core/label/utils.ts`.
- `[command] rg "core/" apps/server/src/database` found exactly these two production imports.

Impact: repository code depends on feature transport/implementation placement; DTO or feature refactoring can break persistence and creates an adapter-to-core reverse edge.

Root cause: domain constants/normalization were placed in convenient feature files rather than a dependency-neutral value module.

Remediation direction: move the default-group values and label canonicalization into narrowly named domain-neutral modules consumed by DTO/service/repository code. Add a dependency-cruiser rule forbidding `database/** -> core/**/dto/**` and direct `database/** -> core/**` imports except an explicit reviewed allowlist.

### ARC-03 - runtime service location bypasses startup validation

Evidence:

- `[code] apps/server/src/core/auth/strategies/jwt.strategy.ts:28-35,131-145` resolves `ApiKeyService` from `ModuleRef` with `strict:false` and fails only during API-key authentication.
- `[code] apps/server/src/integrations/queue/outbox/queue-outbox.service.ts:391-438` dynamically resolves page-template sync and notification delivery handlers during dispatch.
- `[command]` the two focused suites passed 26/26, confirming current wiring but not startup validation.

Impact: a composition regression can boot successfully and fail later as RAG/MCP authentication or an outbox kind is exercised. For an outbox item, that can become repeated retry/terminal failure instead of an immediate deployment failure.

Root cause: cross-feature dependencies and potential module cycles are bypassed with the container as a service locator.

Remediation direction: introduce narrow injection tokens/ports owned at the auth/outbox boundary and bind them in composition modules. Validate the required handler registry during bootstrap for the roles that process those jobs. Keep collab's `registerGeneralWorker:false` role free of worker-only handlers.

### ARC-04 - undeclared/hoisted workspace dependencies

Evidence:

- `[config] packages/editor-ext/package.json:1-12` declares an empty `dependencies` object while the package source imports Tiptap, ProseMirror, React-adjacent and utility packages.
- `[config] .npmrc:1` enables `shamefully-hoist = true`.
- `[command] corepack pnpm exec knip` reports 31 unlisted dependencies, including `nanoid` in client/editor-ext, `dotenv` and validator subpaths in server code, Vitest/jsdom in editor-ext tests, and root-script dependencies.

Impact: the current monorepo build can work because the root installation hoists packages, but a dependency relocation/update, stricter pnpm layout or isolated package build can fail without a manifest change at the actual consumer.

Root cause: dependencies are owned centrally by the root rather than by consuming workspaces, while workspace manifests imply package-local ownership.

Remediation direction: classify every unlisted item by actual runtime/dev/peer owner; declare it in the consuming workspace, or configure Knip for intentionally root-owned tooling. Keep `@docmost/editor-ext` private if independent publication is not supported, but make its build/test/runtime manifest truthful. Verify with a frozen clean install and isolated Nx targets.

### ARC-05 - server consumes the UI-heavy editor root barrel

Evidence:

- `[code] packages/editor-ext/src/index.ts:1-40` re-exports all editor extensions from one root.
- `[code] packages/editor-ext/dist/index.js:17-56` eagerly `require`s every re-export in CommonJS.
- `[code]` 12 server files import the package root, including `main.ts`, collaboration persistence, page/template, import/export and AI tools.
- `[command]` requiring the built root in the running Node 22 API container loads 887 modules and includes React, `@tiptap/react` and `@floating-ui`.

Impact: server startup and server-only utilities are coupled to browser/editor implementation dependencies; a UI-only module side effect or incompatible dependency can break backend startup even when the requested server utility is pure.

Root cause: the package has a single catch-all public entrypoint for both client extensions and server-safe document functions.

Remediation direction: retain the existing root for compatibility, add a documented server-safe subpath barrel containing only pure policies/serializers/diff/transform utilities, and switch server imports incrementally. Add a Node 22 smoke assertion that the server subpath does not load React, `@tiptap/react` or browser-only modules.

### ARC-06 - collaboration role is duplicated

Evidence:

- `[code] apps/server/src/app.module.ts:26-38` imports `CollaborationModule` into the main API.
- `[code] apps/server/src/collaboration/server/collab-app.module.ts:16-31` imports the same module into the dedicated process.
- `[code] apps/server/src/collaboration/collaboration.module.ts:46-73` unconditionally installs the `/collab` upgrade handler on whichever HTTP server owns the module.
- `[config] docker-compose.yml:82-140` runs both the API and a separate collab process from the same image.
- `[code] apps/client/src/lib/config.ts:27-34` falls back from `COLLAB_URL` to the application origin.
- `[interface] local runtime, unauthenticated WebSocket upgrade probe, ports 3000 and 3001` both returned `upgrade-open`. This proves endpoint hosting, not authorized collaboration behavior, and the image is not proven identical to audit `HEAD`.

Impact: scaling the API also scales hidden collaboration hosts/history consumers, exposes two endpoint paths, and makes ownership of WebSocket and collaboration background responsibilities deployment-dependent rather than explicit.

Root cause: one module mixes reusable document services, WebSocket hosting and collaboration worker responsibilities, while two process compositions import it unchanged.

Remediation direction depends on section 9: either preserve an explicit single-process compatibility role and disable hosting in the API only when a dedicated role is configured, or make production dedicated-only while keeping a development composition. Do not split into a microservice/package solely for style.

### ARC-07 - lower layers terminate the process

Evidence:

- `[code] apps/server/src/database/database.module.ts:188-215` calls `process.exit(1)` after connection retries.
- `[code] apps/server/src/database/services/migration.service.ts:17-36` calls `process.exit(1)` on migration error.
- `[code] apps/server/src/integrations/environment/environment.validation.ts:423-450` exits during configuration validation.
- `[code] apps/server/src/main.ts:204-310` and `collaboration/server/collab-main.ts:16-53` do not own a common bootstrap failure boundary.

Impact: fatal startup errors can skip normal Nest shutdown hooks and produce different cleanup behavior across the two entrypoints. No data-loss failure was reproduced in this pass.

Root cause: process lifecycle policy is embedded in validation/infrastructure providers rather than the executable boundary.

Remediation direction: throw typed startup errors from validation/database/migration code; catch them at both entrypoints, log a bounded reason, close an already-created app when applicable, and set a non-zero exit code. Add child-process startup tests for invalid env, unavailable DB and failed migration.

### ARC-08 - oversized multi-responsibility application services

Evidence:

- `[command]` physical-line inventory reports `page-template.service.ts` at 3,438 lines and `database.service.ts` at 3,244 lines.
- `[code] apps/server/src/core/page/services/page-template.service.ts:113-3427` combines discovery/create/publish, legacy migration, sync-run worker/recovery, attachment copying, graph leases and idempotent operation recovery.
- `[code] apps/server/src/core/database/services/database.service.ts:151-3174` combines CRUD/authorization, history display resolution, filter evaluation, Markdown/HTML/PDF/archive export and conversion.

Impact: unrelated lifecycle changes share constructors, mocks and failure surfaces; ownership and safe test selection become harder. This is a change-risk finding, not evidence of a current runtime failure.

Root cause: capabilities accumulated inside original feature services without extracting stable internal seams.

Remediation direction: first extract pure or already separable responsibilities inside the same feature module: page-template legacy migration, sync runner/recovery, and database export/rendering. Keep authorization and transactions at the application-service boundary; do not add a generic layer or change public APIs. Decide further extraction only from change coupling and focused-test improvements.

### ARC-09 - broad global-module use hides dependencies

Evidence:

- `[code] apps/server/src/database/database.module.ts:53-160` marks the module global and exports 30 repositories plus readiness.
- `[command]` source inventory found 13 `@Global()` modules, including database, queue, storage, mail, security, health, policy, session and presence modules.

Impact: feature modules can inject infrastructure without declaring the dependency, weakening Nest composition as an architecture map. Current startup and focused tests pass; this is a maintainability improvement, not a confirmed defect.

Root cause: global modules reduce repetitive imports in a large monolith at the cost of explicit ownership.

Remediation direction: retain configuration/singleton globals that are genuinely cross-cutting; when ARC-02/03 contours are changed, import narrow persistence/handler modules explicitly in those features. Avoid a repository-wide big-bang conversion.

## 8. Limitations and outside scope

Limitations:

- This is not a complete architecture proof: 2,730 unresolved dependency edges prevent trusting the current static cycle result until ARC-01 is fixed.
- Runtime health and upgrade checks used an existing image whose exact source revision is unverified.
- No clean install, full build, full unit/security suite, browser matrix, migration, destructive fault test or production-host check was performed in this pass.
- Only representative transaction, external-provider and large-service contours were inspected; every domain invariant was not re-proven.
- Exact concurrency/idempotency/data-integrity semantics are DAT-owned; public contract compatibility is API-owned; duplicate implementation is DUP-owned; documentation edits are DOC-owned.

Outside scope:

- DUP: jscpd reports 19 clone groups / 578 lines / 0.27%, and Knip reports unused/duplicate exports; these were not analyzed as ARC defects.
- Release/runtime configuration: prior report `EXT-G25-001` for empty `DRAWIO_URL` remains outside ARC and was not reverified here.

## 9. Recorded architecture decision

Decision received on 2026-08-12:

- production uses a dedicated API process and a dedicated collaboration process;
- development uses the same split: frontend, API and collaboration run as three processes;
- the main API must not host `/collab`, instantiate a Hocuspocus document runtime, consume collaboration-history work, or become a collaboration document owner;
- no supported fallback to an API-hosted collaboration endpoint remains.

Compatibility consequence: installations that currently rely on `COLLAB_URL -> APP_URL` fallback become unsupported and must start the collaboration process. `COLLAB_URL` becomes a required public browser URL. API-to-collaboration live-document commands require a separate internal transport; the plan below uses an authenticated internal collaboration command endpoint so API feature services never host Yjs documents.

No further product or architecture question remains before plan approval.

## 10. Coordinated remediation plan

### 10.1 Target boundary

The target runtime has these explicit directions:

1. Browser HTTP/API traffic -> main API process.
2. Browser Yjs WebSocket traffic -> public `COLLAB_URL` -> collaboration process.
3. API page/template/AI live-document operations -> narrow `CollaborationDocumentPort` -> authenticated internal collaboration command endpoint -> `CollaborationGateway` in the collaboration process.
4. Only the collaboration process owns Hocuspocus, Redis document leases/proxy sockets, persistence extensions and the history worker.
5. PostgreSQL and Redis remain shared infrastructure. No database schema migration is required for the process split.

The internal transport is not a new public product API. It uses a server-only `COLLAB_INTERNAL_URL` and a dedicated file-backed `COLLAB_INTERNAL_SECRET`; deployments must keep the route off the public reverse-proxy surface. Requests and responses must be bounded, authenticated before dispatch, excluded from logs, time-limited, and fail closed. This is the incremental option because it reuses the existing `CollaborationGateway` and Redis owner-routing on the selected collab instance. A new durable queue, microservice repository, or replicated document store is not justified.

### 10.2 Safe execution stages

| Stage                                       | Items          | Purpose                                                                           | Gate before next stage                                                       |
| ------------------------------------------- | -------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 0. Make architecture evidence trustworthy   | ARC-01         | Resolve aliases and reject hidden internal edges                                  | full dependency graph resolves; any newly revealed violation is triaged      |
| 1. Repair small static boundaries           | ARC-02, ARC-04 | Remove reverse imports and declare dependency ownership                           | architecture check, Knip unlisted set, clean frozen install/build pass       |
| 2. Introduce narrow composition seams       | ARC-03, ARC-05 | Remove service-location and UI-heavy server barrel coupling                       | focused DI and Node 22 package-boundary tests pass                           |
| 3. Separate collaboration runtime           | ARC-06         | Move all collaboration hosting/ownership to the dedicated process in prod and dev | API cannot upgrade `/collab`; live API commands still operate through collab |
| 4. Centralize executable lifecycle          | ARC-07         | Put fatal startup policy at the two entrypoints                                   | child-process failure and shutdown tests pass                                |
| 5. Reduce change blast radius incrementally | ARC-08, ARC-09 | Extract stable responsibilities and make touched dependencies explicit            | characterization and feature regression suites pass without contract changes |
| 6. Repository-wide acceptance               | all            | Prove the integrated target                                                       | clean build, full/release gates and exact production/dev runtime matrix pass |

### 10.3 ARC-01 - make the architecture gate complete

- Direction/status/severity/priority/size: ARC; defect; medium; P1; S.
- Affected scope: `.dependency-cruiser.cjs`, new root architecture-only tsconfig or resolver map, root `package.json`, and a focused architecture-gate regression under `scripts/`.
- Evidence/reproduction: the current gate reports 0 violations while 2,730/5,754 dependencies have `couldNotResolve=true`; the client/server tsconfigs define the unresolved repository aliases.
- Impact: alias-based cycles and forbidden server/client edges can pass every `verify:*` command.
- Root cause: dependency-cruiser has extensions but no aggregate TypeScript path configuration and no failure rule for unresolved repository-owned aliases.
- Proposed solution: add a root resolver config covering `@/*`, `src/*`, `@docmost/db/*`, `@docmost/transactional/*`, `@docmost/api-contract/*` and `@docmost/editor-ext/*`; make any unresolved internal alias blocking; preserve explicitly classified external/optional imports. Add fixtures that introduce an alias cycle and server/client crossing and assert non-zero results.
- Dependencies: none; this is the first implementation item. Any real cycle exposed by the corrected graph blocks later stages until classified or fixed.
- Change/compatibility risks: a corrected gate may reveal baseline violations. Record them as baseline findings; do not weaken the resolver or add a broad allowlist to regain green status.
- Required checks: architecture regression tests, `check:architecture`, `verify:quick`, direct JSON assertion that unresolved internal aliases equal zero.
- Acceptance: all repository-owned aliases resolve; the two negative fixtures fail; current code has either zero real violations or exact reviewed findings with separate remediation.

### 10.4 ARC-02 - restore core-to-persistence direction

- Direction/status/severity/priority/size: ARC; defect; low; P1; S.
- Affected scope: `database/repos/group/group.repo.ts`, `core/group/dto/create-group.dto.ts`, `database/repos/label/label.repo.ts`, `core/label/utils.ts`, plus narrowly named neutral value modules.
- Evidence/reproduction: the database tree has exactly two production imports into `core/**`: `DefaultGroup` from a DTO and `normalizeLabelName` from feature implementation.
- Impact: transport/file-placement changes can break persistence and preserve reverse adapter dependencies.
- Root cause: reusable domain values were placed beside transport or feature implementation for convenience.
- Proposed solution: move the default-group values and label canonicalization into dependency-neutral modules; DTOs, services and repositories import those values independently. Add a rule forbidding `database/** -> core/**/dto/**` and unreviewed `database/** -> core/**` imports.
- Dependencies: ARC-01 so the rule observes aliases and relative imports consistently.
- Change/compatibility risks: default group text and stored label normalization must remain byte-for-byte compatible; no data rewrite or migration.
- Required checks: group/label service and repository tests, no new data diff, architecture rule negative fixture.
- Acceptance: `rg "core/" apps/server/src/database` has no unapproved production hits; existing group names and normalized label values are unchanged.

### 10.5 ARC-03 - replace runtime service location with explicit ports

- Direction/status/severity/priority/size: ARC; risk; medium; P1; M.
- Affected scope: `JwtStrategy`, `ApiKeyService/ApiKeyModule`, auth composition, `QueueModule`, `QueueOutboxService`, page-template and notification handler bindings, and `AppModule`/`CollabAppModule` worker composition.
- Evidence/reproduction: `JwtStrategy` and `QueueOutboxService` call `ModuleRef.get(..., {strict:false})`; current focused tests pass only because the providers happen to be present.
- Impact: a composition regression boots successfully and fails only on API-key auth or a specific outbox kind.
- Root cause: management and validation responsibilities are combined in `ApiKeyService`; outbox producer/infrastructure and worker dispatch are combined in one global module.
- Proposed solution:
  1. Extract API-key validation into a small auth-facing service/module that depends only on validation repositories/policies; inject it directly into `JwtStrategy`. Keep management and MCP capability selection in `ApiKeyModule`.
  2. Split queue transport/outbox enqueue services from the general outbox worker. A worker composition module imports page/mail handler modules explicitly and injects a typed handler registry; the collab process imports queue transport without general/outbox workers.
  3. Validate the complete handler registry at startup in the API worker role.
- Dependencies: ARC-01. The queue split should precede ARC-06 so process ownership is testable without `ModuleRef` ambiguity.
- Change/compatibility risks: avoid circular `AuthModule <-> ApiKeyModule` and `PageModule <-> QueueWorkerModule` imports by keeping validation and producer modules independent. Preserve outbox kinds, payloads, dedupe keys and transaction signatures.
- Required checks: JWT/API-key security suites; outbox 26-test focused suite plus producer tests; missing-binding bootstrap negative tests; collab composition test proving no general worker.
- Acceptance: no production `ModuleRef.get` remains in auth/outbox dispatch; missing required handlers fail bootstrap; RAG/MCP keys and every existing outbox kind retain behavior.

### 10.6 ARC-04 - make workspace dependency ownership truthful

- Direction/status/severity/priority/size: ARC; defect; medium; P1; M.
- Affected scope: root, server, client, `api-contract` and `editor-ext` manifests; `.npmrc`; `pnpm-lock.yaml`; Knip configuration only for demonstrably intentional tool entrypoints.
- Evidence/reproduction: `editor-ext` declares no dependencies, `.npmrc` enables shameful hoisting, and Knip reports 31 unlisted dependencies plus 6 binaries.
- Impact: stricter pnpm layout, isolated builds or dependency movement can break consumers without a manifest change at the owner.
- Root cause: dependencies accumulated in the root installation instead of consuming workspaces.
- Proposed solution: classify each unlisted import as runtime, development, binary or intentional root tooling; declare it at the consuming workspace. `editor-ext` is private, so use package-local runtime/dev dependencies rather than publication-oriented peers unless a real peer requirement exists. After manifests are green, test without `shamefully-hoist`; remove it or replace it with the smallest proven `public-hoist-pattern`.
- Dependencies: ARC-01 for reliable cross-workspace edges. Manifest changes precede ARC-05 exports.
- Change/compatibility risks: lockfile changes are expected and must contain only dependency-ownership movement, not upgrades. Preserve pinned/overridden versions.
- Required checks: `pnpm install --frozen-lockfile` after regenerated lockfile, isolated Nx builds for all four workspaces, Knip, full Node 22 Docker build.
- Acceptance: no unexplained unlisted dependency/binary remains; all workspaces build in a clean non-shamefully-hoisted installation or a narrow documented exception is proven necessary.

### 10.7 ARC-05 - add a server-safe editor entrypoint

- Direction/status/severity/priority/size: ARC; risk; medium; P1; M.
- Affected scope: `packages/editor-ext/src/index.ts`, new server-safe source entrypoint, package `exports`/build configuration, and the 12 server root imports in main/collaboration/page/AI/import/export code.
- Evidence/reproduction: the CommonJS root barrel eagerly requires all 40 exports; Node 22 loads 887 modules including React, `@tiptap/react` and `@floating-ui`.
- Impact: server startup is coupled to browser/editor implementation dependencies and UI-only side effects.
- Root cause: one catch-all package entrypoint serves both interactive React extensions and pure server document utilities.
- Proposed solution: preserve `@docmost/editor-ext` for client compatibility; add `@docmost/editor-ext/server` exporting only Node-safe policies, serializers, transforms, schema utilities and document diff functions; migrate server imports to the subpath. Keep collaboration-specific Tiptap/Yjs dependencies only where the collab runtime genuinely needs them.
- Dependencies: ARC-04 truthful package dependencies.
- Change/compatibility risks: exported symbol identity and editor schema composition must remain unchanged; do not split the package or change stored document JSON.
- Required checks: package build/types; existing editor-ext tests; server build; Node 22 require-cache smoke; import/export/PDF/collaboration/AI focused suites.
- Acceptance: requiring the server subpath loads no React, `@tiptap/react`, browser globals or UI floating libraries; no server production file imports the root barrel; client imports remain compatible.

### 10.8 ARC-06 - enforce a dedicated collaboration process

- Direction/status/severity/priority/size: ARC; risk promoted to confirmed target defect by the recorded decision; medium; P1; L.
- Affected modules/files:
  - `AppModule`, `CollabAppModule`, current `CollaborationModule`, `CollaborationGateway`, extensions and `HistoryProcessor`;
  - `PageModule`, `AiModule`, `PageService`, `PageTemplateService`, `AiToolRegistryService`, `AiRunStepService`;
  - a new narrow collaboration document contract/client module and internal collab command controller/adapter;
  - root/server package scripts, Nx targets, Docker Compose, environment validation/static config, `.env.example`, `.env.compose.example`, Docker secrets, CI production smoke and browser harness configuration;
  - `README.md`, `AGENTS.md`, `ARCHITECTURE.md`, route/env inventories and collaboration runbooks.
- Evidence/reproduction: both application compositions import the same module; it unconditionally mounts `/collab`; runtime upgrades succeed on ports 3000 and 3001; four core services use `CollaborationGateway.handleYjsEvent` for live commands.
- Actual/possible impact: the API currently becomes a hidden document host/worker. Removing it without a remote command port would break page updates, page templates and AI live-hash/write operations.
- Root cause: WebSocket hosting, Hocuspocus ownership, history work and an application-facing live-document command API are combined in one module/class.
- Concrete solution:
  1. Define `CollaborationDocumentPort` with explicit operations for page content read/update, content hash, AI mutation and page-template mutation. Core page/AI services depend on this port, not `CollaborationGateway` or string event names.
  2. Create an API-side client adapter using `COLLAB_INTERNAL_URL` and `COLLAB_INTERNAL_SECRET`. Use bounded request/response schemas, strict timeouts, stable error mapping and secret-safe logging. Collaboration unavailability returns 503 and never falls back to persisted stale content.
  3. Add an internal collab command endpoint owned by `CollabAppModule`. It authenticates the dedicated secret, validates the operation/payload, and calls the local `CollaborationGateway`; that gateway retains existing Redis owner routing and lease fencing between multiple collab instances.
  4. Split the current module into a client contract/module and a runtime module. Only `CollabAppModule` imports the runtime module and owns WebSocket upgrade, Hocuspocus extensions, document leases, persistence and `HistoryProcessor`. `AppModule`, `PageModule` and `AiModule` import only the client module.
  5. Remove `CollaborationModule` from `AppModule`. The API port must not answer a WebSocket upgrade for `/collab`.
  6. Make public `COLLAB_URL`, server-only `COLLAB_INTERNAL_URL` and the internal secret mandatory for supported operation. Remove the client `APP_URL` fallback. Compose uses `http://collab:3001` internally and the configured public browser URL externally.
  7. Change root `pnpm dev` to start `frontend`, `api` and `collab` together. Change `collab:dev` from a one-time built `dist` command to a watched Nest entrypoint; keep individual `server:dev` and `collab:dev` commands available.
  8. Keep API liveness independent of collab liveness to avoid restart cascades, but expose/record a bounded collab dependency failure and gate production smoke on both processes.
- Dependencies: ARC-01, ARC-03 queue/DI separation and preferably ARC-05. Internal endpoint auth and error contracts need focused security/API review because those owner modules are not connected to this audit.
- Change/compatibility risks:
  - public HTTP APIs, token shape, Yjs document names and persisted schema remain unchanged;
  - API-hosted `/collab` is intentionally removed, so deployments must update before rollout;
  - add a new required secret and internal URL without logging either value;
  - deploy the new collab runtime/endpoint first, verify health, then deploy the API client; rollback the API before rolling back collab. Do not mix a new API with an old collab process that lacks the internal command endpoint.
- Required checks:
  - module-composition tests: API has no `CollaborationGateway`, Hocuspocus host or history worker; collab has all three;
  - wire test: API `/collab` does not return 101; collab `/collab` does;
  - internal auth negatives: absent/wrong secret, oversized/unknown operation, timeout and malformed response fail closed without payload logging;
  - page replace/append, template mutation and AI content/hash/apply operations succeed through the remote port;
  - collab stopped/restarted -> API operation returns stable 503 then recovers, without DB fallback;
  - two collab instances -> single lease owner, command routes to current owner, lease-loss behavior remains green;
  - root `pnpm dev` smoke proves three watched processes and browser editing on port 3001;
  - production image/Compose smoke, collaboration E2E, editor/AI/AI-context matrices, security suite and `verify:release`.
- Acceptance:
  - only the collab process can upgrade `/collab`, own `collabLock:*` or run `HistoryProcessor`;
  - all API live-document consumers use the injected port and pass their prior behavior tests;
  - development starts separate API and collab processes by default;
  - missing collab configuration fails startup clearly; collab outage fails affected operations closed;
  - no public API, stored Yjs data or database schema changes.

### 10.9 ARC-07 - move fatal process policy to entrypoints

- Direction/status/severity/priority/size: ARC; risk; low; P2; S.
- Affected scope: `DatabaseModule`, `MigrationService`, environment validation, `main.ts`, `collab-main.ts`, and a small shared bootstrap failure helper if it removes exact duplication.
- Evidence/reproduction: infrastructure providers and config validation call `process.exit(1)`; the two bootstraps have no common catch/cleanup policy.
- Impact: fatal startup can bypass shutdown hooks and behave differently across API/collab roles.
- Root cause: executable lifecycle policy lives in lower layers.
- Proposed solution: lower layers throw typed/bounded startup errors. Both entrypoints catch, close an already-created Nest app, redact details, set non-zero `process.exitCode`, and let the event loop drain. Keep explicit process exits only in standalone CLI commands where process ownership is intentional.
- Dependencies: ARC-06 so both final compositions are covered.
- Change/compatibility risks: startup must still terminate promptly; never retry migrations in both entrypoints outside the existing advisory lock contract.
- Required checks: child-process tests for invalid env, unavailable DB and failed migration; graceful SIGTERM for both roles; no open-handle regression.
- Acceptance: server provider/config code has no `process.exit`; both entrypoints return non-zero after cleanup and log only bounded error codes.

### 10.10 ARC-08 - split stable responsibilities inside existing features

- Direction/status/severity/priority/size: ARC; risk; medium; P2; L.
- Affected scope: page-template service/module/tests; database feature service/module/tests; existing export integration where ownership is already established.
- Evidence/reproduction: `PageTemplateService` combines CRUD/publish, legacy migration, sync worker/recovery, attachment copying and operation leases; `DatabaseService` combines CRUD/ACL/history/filtering with Markdown/HTML/PDF/archive rendering.
- Impact: unrelated changes share constructors, mocks and failure boundaries; no current functional defect was reproduced.
- Root cause: stable responsibilities accumulated in original application services.
- Incremental solution:
  1. Add characterization tests around current public methods and transaction/error boundaries.
  2. Extract page-template legacy migration and sync-run execution/recovery into feature-internal services; keep authorization, publish transaction and public controller orchestration in `PageTemplateService`.
  3. Extract database export/rendering and its locale/ZIP/PDF helpers into a database export service; keep database CRUD, ACL and row/property transaction orchestration in `DatabaseService`.
  4. Stop after these seams. Further extraction needs evidence from change coupling or test isolation; no new generic repository/domain layer or microservice.
- Dependencies: ARC-01 and ARC-03; perform after ARC-06 so collaboration command ownership is already stable.
- Change/compatibility risks: preserve transaction boundaries, page-template idempotency/lease recovery, export formats and controller/API shapes. No schema migration.
- Required checks: existing page-template lifecycle/outbox/fault suites; database CRUD/ACL/history/export tests; archive/PDF/browser acceptance; diff fixtures for exported content.
- Acceptance: migration/sync worker code is no longer owned by `PageTemplateService`; export/rendering dependencies are absent from `DatabaseService`; all public methods and serialized outputs remain compatible.

### 10.11 ARC-09 - make touched feature dependencies explicit

- Direction/status/severity/priority/size: ARC; improvement; low; P3; L over time, S/M in this plan.
- Affected scope: `DatabaseModule` and new/narrow persistence submodules for the group, label, API-key and queue-outbox contours touched by ARC-02/03.
- Evidence/reproduction: 13 modules are global; `DatabaseModule` globally exports 30 repositories plus readiness.
- Impact: Nest module metadata does not reveal actual feature dependencies. Current runtime is valid, so a repository-wide conversion is not justified.
- Root cause: broad globals were the low-friction composition mechanism as the monolith grew.
- Proposed solution: keep genuinely cross-cutting configuration/client singletons global. Create narrow persistence modules for only the contours modified by this plan; have the legacy global database composition import/re-export them temporarily, while touched feature modules import them explicitly. Add no duplicate provider instances. Record remaining global exports as migration inventory, not immediate debt to rewrite.
- Dependencies: ARC-02 and ARC-03.
- Change/compatibility risks: duplicate repository/provider instances or Kysely connections are unacceptable; do not remove `@Global()` from the aggregate module until all consumers are explicit and bootstrap tests pass.
- Required checks: Nest module compilation for API/collab; provider identity test; dependency-cruiser rule/report for explicit modules; full server suite.
- Acceptance: group, label, API-key auth and outbox worker dependencies are explicit in their module imports; the remaining global catalog is documented and no new global module is introduced.

### 10.12 Quick fixes, blockers and decisions

Quick fixes:

- ARC-01 resolver/gate correction.
- ARC-02 neutral value placement and reverse-import rule.
- ARC-07 process-exit relocation after the runtime split.

Blocking items:

- ARC-01 can expose currently hidden violations; these must be triaged before architecture PASS.
- ARC-06 cannot ship until `COLLAB_INTERNAL_URL` and `COLLAB_INTERNAL_SECRET` are provisioned and the collab-first rollout is documented/tested.
- Internal-command authentication, payload limits and error compatibility need security/API-focused review; this ARC plan covers their placement but not a full SEC/API audit.
- A clean Node 22 install/build is required after ARC-04 before accepting package-boundary results.

Resolved architecture decision:

- dedicated collaboration is mandatory in production and development; no API-hosted fallback.

Implementation choice proposed for approval:

- use a narrow authenticated internal HTTP command adapter from API to collab, not BullMQ/durable payloads and not a second Hocuspocus runtime in the API. This keeps live-document ownership in one process role and reuses the existing Redis lease/proxy behavior inside collab.

### 10.13 Final acceptance and handoff

The implementation is accepted only when all of the following are true:

1. `check:architecture` resolves all internal aliases and its negative fixtures fail as designed.
2. Knip has no unexplained unlisted dependency/binary and a clean Node 22 workspace/image build passes.
3. API has no `/collab` upgrade, Hocuspocus runtime, document lease ownership or collaboration history worker.
4. Dedicated collab owns those responsibilities in both Compose and `pnpm dev`.
5. Page, template and AI live-document operations work through the remote port; collab outage fails them closed with 503.
6. Existing public APIs, token semantics, Yjs document data, outbox payloads and database schema remain compatible.
7. Targeted suites, `verify:quick`, `verify:full`, production-image smoke and `verify:release` pass in the exact final runtime. Baseline unrelated failures must be reported separately rather than repaired under ARC.
8. `README.md`, `AGENTS.md`, `ARCHITECTURE.md`, environment examples/contracts, runbooks and CI commands describe the final three-process development and two-process backend topology.

Implementation was authorized after this plan was reviewed. The results and remaining evidence gaps are recorded below.

## 11. Implementation results

Implementation date: 2026-08-12

### 11.1 Outcome by finding

| ID     | Implementation status                          | Result and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ARC-01 | remediated                                     | Added `tsconfig.architecture.json`, complete alias resolution, blocking dependency rules, three negative fixtures and a collab-process boundary check. `[command] corepack pnpm check:architecture` passed with 1,942 modules, 6,064 dependencies and 0 violations; all 3 negative tests passed.                                                                                                                                                                                                                                                               |
| ARC-02 | remediated                                     | Moved default-group values and label normalization into `common/domain`; persistence no longer imports feature implementation. The architecture gate now rejects `database/** -> core/**`.                                                                                                                                                                                                                                                                                                                                                                     |
| ARC-03 | remediated                                     | Replaced auth and outbox service location with direct DI. API-key validation has a narrow module/service. The API composition root now binds a typed outbox handler registry and validates it at startup; collab imports queue transport without the general worker. `[command]` focused queue registry/binding/module suites passed 6/6.                                                                                                                                                                                                                      |
| ARC-04 | remediated                                     | Removed shameful hoisting, assigned runtime/dev dependencies to their consuming workspaces, updated the lockfile without a dependency upgrade operation, and repaired the production image's package-local module copies. `[command] corepack pnpm install --frozen-lockfile` and the clean Docker production install/build passed.                                                                                                                                                                                                                            |
| ARC-05 | remediated                                     | Added `@docmost/editor-ext/server`, migrated server imports to it and kept the client root entry compatible. `[command] corepack pnpm test:editor-ext:server` passed and proved the server entrypoint does not load React or browser UI adapters.                                                                                                                                                                                                                                                                                                              |
| ARC-06 | remediated with residual runtime coverage      | Only `CollabAppModule` owns the Hocuspocus runtime, document leases and collaboration history worker. API consumers use `CollaborationDocumentPort` through an authenticated, timeout-bounded internal HTTP adapter. Compose and `pnpm dev` use separate API/collab processes, with mandatory public/internal URLs and a file-backed internal secret. `[interface]` clean Compose health was 200 on ports 3000 and 3001; API `/collab` failed the WebSocket upgrade, collab `/collab` opened, and the internal command endpoint without a secret returned 401. |
| ARC-07 | remediated with residual failure-path coverage | Database/config/migration layers throw typed startup errors. API and collab entrypoints own termination policy and close an already-created Nest application before returning a non-zero exit code. Normal clean-image startup passed; invalid-env/DB child-process and SIGTERM fault tests were not run.                                                                                                                                                                                                                                                      |
| ARC-08 | remediated incrementally                       | Extracted database export/rendering and page-template runtime/migration/sync orchestration into feature-internal services while preserving controller contracts, data formats and transaction call sites. Existing feature and full backend suites passed.                                                                                                                                                                                                                                                                                                     |
| ARC-09 | accepted incremental improvement               | Added narrow persistence modules for group, label, API-key validation and queue outbox; touched features import them explicitly. The legacy aggregate database module temporarily re-exports them, as planned, to avoid a repository-wide high-risk migration.                                                                                                                                                                                                                                                                                                 |

### 11.2 Final verification

| Check                                  | Actual result                                                                                                                                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `corepack pnpm verify:full`            | exit 0: build and lint passed; backend 231 suites / 1,805 tests; client 139 files / 663 tests; server security 66 suites / 797 tests; client security 6 files / 78 tests.                                   |
| `corepack pnpm check:architecture`     | exit 0: 1,942 modules, 6,064 dependencies, no violations; 3/3 negative fixtures; collaboration boundary contract passed.                                                                                    |
| `corepack pnpm check:env`              | exit 0: 5/5 contract tests and environment synchronization passed.                                                                                                                                          |
| `corepack pnpm routes:inventory:check` | exit 0: generated inventory current at 316 routes.                                                                                                                                                          |
| `corepack pnpm check:release-gates`    | exit 0: 60/60 tests.                                                                                                                                                                                        |
| `corepack pnpm check:comments:en`      | exit 0.                                                                                                                                                                                                     |
| `corepack pnpm test:editor-ext:server` | exit 0: 1/1.                                                                                                                                                                                                |
| `corepack pnpm audit:architecture`     | Non-blocking report: dependency graph clean; no unlisted dependency or binary remained; 5 unused devDependencies, 161 unused exports and 19 duplicate-code groups were reported for their owner directions. |
| `docker compose up -d --build`         | clean production dependency install, all-workspace build and image smoke passed; API and collab containers became healthy.                                                                                  |
| Runtime HTTP/WS probes                 | API health 200; collab health 200; unauthenticated internal command 401; API `/collab` did not open; collab `/collab` opened.                                                                               |
| `git diff --check`                     | exit 0.                                                                                                                                                                                                     |

The full backend Jest run emitted a non-failing warning that one worker did not exit gracefully and was force-terminated. The client build retained the existing warning for a chunk larger than 1,500 kB. The non-blocking duplicate-code audit also retained 19 baseline groups (0.27%). None of these signals changed the command exit status; they remain follow-up diagnostics for their owning directions rather than ARC acceptance failures.

### 11.3 Compatibility and remaining limits

Preserved contracts:

- public HTTP routes and generated inventory shape apart from the new internal collab-only route;
- collab token/session semantics, Yjs document naming and persisted document data;
- database schema and migrations;
- outbox kinds, payloads, dedupe keys and transactional producer signatures;
- client root editor package imports.

Not yet proven:

- authenticated two-browser collaborative editing against the final image;
- an interactive `pnpm dev` smoke with all three watched processes;
- API live-document commands through the real authenticated user/page flow, including outage and recovery;
- a two-collab-instance lease-owner/failover scenario;
- invalid-environment, unavailable-database, failed-migration and SIGTERM child-process lifecycle checks;
- `verify:release`, which requires the documented production-like runtime and browser audit environment;
- real production reverse proxy, TLS and secret provisioning.

The result therefore proves the requested process boundary and the repository's full local verification, but is not a production-release PASS. The five pre-existing user-owned `graphify-out/*` modifications remain untouched. The implementation was committed locally as `8d32f6dc`; no push, pull request, tag or release was created.
