# Docmost v1.1.0 release-readiness audit

Date: 2026-08-14
Baseline: `main` at `b2031572` before the uncommitted remediation
Overall verdict: **BLOCKED**

## Executive result

| Dimension | Result | Evidence boundary |
| --- | --- | --- |
| Code/runtime readiness | READY | The complete local release pipeline, production image, fresh database migrations, API/collaboration health, restart smoke, security suites, browser acceptance, RAG Sync contract/E2E, and real Open WebUI v0.11.0 compatibility passed. |
| Integration readiness | PARTIAL | Open WebUI and repository fixtures are verified. The full external matrix was not provisioned for Typesense, MinIO, Keycloak, Mailpit, LLDAP, Postmark, a physical Web Push subscription, or live PostHog capture. |
| Deployment readiness | BLOCKED | There is no GitHub-hosted CI result for the actual release commit, and the explicitly excluded v1.0.0 production-copy upgrade/rollback rehearsal was not performed. |

No reproducible open P0, P1, P2, or release-blocking P3 code defect remained after remediation. This does not override the deployment blockers above.

## Baseline and release contract

- The repository was clean at the initial checkpoint. `HEAD` and `origin/main` were `b2031572`.
- Root, client, and server manifests all declared `1.1.0`.
- `git describe --tags --long` returned `v1.0.0-360-gb2031572`; tag `v1.1.0` did not exist and was not created.
- The release delta contained 21 migrations after v1.0.0 and 1,215 changed files.
- Validation used the pinned Node 22 production container where runtime identity mattered. The Windows host used Node 24 and was not treated as production evidence.
- No commit, push, pull request, tag, image publication, or release operation was performed.

## Release defect and remediation

The live `General` binding repeatedly failed with an unexpected `NotFoundException`. The data and query audit found 246 active attachment rows whose parent pages were missing or soft-deleted. The attachment update feed filtered only the attachment tombstone and could therefore emit an orphan before its checkpoint advanced.

The remediation:

1. Filters attachment updates through an active parent page in the same workspace and space.
2. Treats a source that disappears between feed read and export as a controlled tombstone/remote cleanup for pages, database rows, and supported attachments.
3. Stops and fences a binding on non-retryable scope or target failure. A missing remote Knowledge Base clears target verification and requires a new writer test before re-enable.
4. Restricts runtime diagnostics to allowlisted `stage` and `sourceKind` fields; URLs, credentials, document content, and raw upstream errors are not logged.
5. Limits portable attachment publication to PDF, DOCX, TXT, and Markdown. Raster images remain in Docmost but are skipped because an Open WebUI deployment without OCR can reject them and poison the incremental queue.
6. Gives all RAG Sync E2E API replicas and the collaboration process one shared local-storage volume, matching the production storage contract.

The public API and database schema were not changed. The canonical AI/RAG document, admin guide contract version 6, structured guide, all 12 locales, and v1.1.0 release notes were updated together.

## Live `General` canary

- A dedicated page was created and Revision 1 was observed in the RAG Sync mapping.
- The page body was edited through the real UI to Revision 2. Its mapping changed to content hash `3329ae187764025b335b654bf8281d92e1d2b3bec039c37a90c03eb1f6bf8c13`, proving that the update reached Open WebUI rather than only the local database.
- The page was moved to trash through the real UI. PostgreSQL recorded the tombstone and the remote mapping disappeared after the deleted feed completed.
- Four samples over 46 seconds showed advancing successful attempts, `errorCode=null`, and no returning mapping. No `NotFoundException` or retry storm recurred.
- The subsequent historical backfill completed with 237 current mappings, no unfinished feed progress, `health=healthy`, `lagMs=1`, `errorCode=null`, and `processedCount=0`.
- To bound the wait during a full historical rebuild, only the disposable canary's `updated_at` value was moved to the active feed timestamp. Existing pages and users were not modified. A temporary Redis cursor acceleration attempt was abandoned; the saved cursor was restored and normal ordered processing continued without permanently skipped items.
- The canary remains recoverable in trash under the ordinary 30-day retention policy; it was not permanently deleted.

## Verification evidence

| Check | Result |
| --- | --- |
| `corepack pnpm verify:release` | PASS, exit 0, 995.9 seconds |
| `corepack pnpm check:release-version` | PASS, manifest/release/MCP contract for 1.1.0 |
| `corepack pnpm check:release-gates` | PASS, 68 mutation and negative-path tests |
| `corepack pnpm test:rag-sync:contract` | PASS, 16 suites and 169 tests |
| Targeted RAG source regression suite | PASS, 40 tests |
| `corepack pnpm test:rag-sync:e2e` | PASS, two API replicas, collaboration, shared storage, citation and ACL-revocation browser flow |
| `corepack pnpm test:rag-sync:open-webui` | PASS against real Open WebUI v0.11.0 writer and retrieval contracts |
| Backend security suite | PASS, 66 suites and 800 tests |
| Frontend security suite | PASS, 6 files and 78 tests |
| AI browser acceptance | PASS, 25 scenarios across locale, browser, mobile, fault, concurrency, and secret-redaction paths |
| Editor browser acceptance | PASS, 23 scenarios across Chromium, Firefox, and WebKit |
| AI Agent and AI context acceptance | PASS |
| AI documentation contract | PASS, version 6, 12 locales, 20 critical routes, root `/mcp`, and 14 migrations |
| Route, RAG docs, environment, text, comment-language, and audit-exception contracts | PASS |
| Production dependency audit | PASS at high threshold; one time-bounded ignored React Router advisory remains documented as non-applicable to this SPA build |
| Architecture dependency audit | PASS, 0 boundary violations across 1,965 modules and 6,128 dependencies |
| Production database runtime smoke | PASS, glibc runtime enforcement, fresh migration, dump corruption/interruption rejection, rerun, unknown-migration/index/role checks, API and collaboration health |
| Production image inspection | PASS: Node 22.23.2, direct compiled `node` entrypoint, no package-manager binaries, no source maps/declarations, no dependency `.env` files, and no known secret markers |
| Bounded load smoke | 500 health requests at concurrency 20, 0 errors; p50 19.5 ms, p95 51.07 ms, p99 54.63 ms, max 107.34 ms; API/collaboration stayed healthy and memory was stable |
| Responsive browser matrix | PASS at 320x568, 768x1024, 1440x900, and 2560x1440 with no horizontal overflow or unnamed visible buttons |

The bounded load result is only a regression smoke. It is not a capacity or SLO claim because no representative production workload or approved threshold was supplied.

The first release-pipeline attempt used a host-only AI fixture origin (`127.0.0.1`) that was unreachable from the containerized browser runtime. This was an audit-environment error, not a product failure. The complete pipeline was rerun with the documented `host.docker.internal` fixture origin and passed with exit code 0.

An additional standalone `tsc --noEmit` experiment found the pre-existing Kysely mismatch in `test/app.e2e-spec.ts`. It is outside the release command contract; the official server build and all required release gates passed.

## Dependency and failure register

| Dependency | Current evidence | Remaining boundary |
| --- | --- | --- |
| PostgreSQL 18 | Pinned Debian/glibc image, fresh migrations, runtime preflight, corrupted/interrupted restore rejection, restart smoke | Real v1.0.0 copy upgrade/rollback rehearsal excluded |
| Redis 8 | RAG Sync leases/state, rate-limit/security tests, restart/fault fixtures | No production-size state or sustained failover test |
| Collaboration service | Dedicated process, health, session binding, lease fencing, browser/editor acceptance | No multi-region or representative production latency evidence |
| Local/S3 storage | Local shared-volume replica regression, upload/path/MIME/export security | MinIO/S3 endpoint not exercised live in this audit |
| Typesense | Contract and failure-path coverage | Official live container integration not provisioned |
| Mail/outbox | Transactional outbox, deduplication, retry, and log-redaction suites | Mailpit and Postmark test-delivery modes not exercised live |
| Web Push | Expired/410 and security fixtures | Physical Chrome subscription after a user gesture not performed |
| SSO/OIDC/LDAP | Provider, enforcement, SSRF, session, and role tests | Keycloak and LLDAP live containers not provisioned |
| AI provider/retrieval | Browser mock/fault matrices and configured-origin enforcement | No production provider credential acceptance claim |
| Open WebUI | Real v0.11.0 writer/retrieval compatibility plus live `General` create, update, and delete canary | External service availability remains operationally owned outside Docmost |
| Inbound/outbound MCP | Contract, origin, policy, rate-limit, and browser fixtures | No live inbound token was supplied for an external client session |
| Draw.io | Browser shim and production runtime gate | No external availability/SLO claim |
| Chromium/PDF | Production image, PDF allowlist/security, Chromium/Firefox/WebKit browser exports | Physical printer and very large document performance not characterized |
| Telemetry/PostHog | Privacy and failure-path tests | Live PostHog capture not provisioned |

## Remaining release blockers and risks

1. A GitHub-hosted CI run must pass for the exact commit that will be tagged.
2. Upgrade and rollback must be rehearsed on an anonymized v1.0.0 production copy. This check was explicitly excluded from the current scope.
3. The external integration gaps above must either be executed in the target environment or accepted explicitly by release ownership.
4. Non-blocking maintenance findings remain: two unused files, six unused development dependencies, 161 unused exports, and 19 duplicate fragments (0.26%). They were not expanded into unrelated refactoring.
5. The OpenWebUI credential used during validation must be rotated because it was exposed outside the repository during the audit conversation. No credential was written to tracked files or persisted audit output.

## Release decision

The remediated working tree is locally code/runtime-ready for a candidate commit, subject to review of the uncommitted diff. Integration readiness is partial, deployment readiness is blocked, and the overall v1.1.0 release decision remains **BLOCKED** until both external deployment proofs are available.
