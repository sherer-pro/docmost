# G10 Page Template Lifecycle Audit - 2026-08-11

## Verdict

**PASS WITH RISKS.** Four reproducible G10 defects were fixed and revalidated. No remaining G10 release blocker was found in the exercised deployment, policy, regular-template, synchronized-template, export, concurrency, retry, restart, and browser paths. Residual risk is limited to scenarios that were not executed against a live external object store or live AI provider, and to a hand-crafted raw Yjs client beyond the covered API bypass, collaboration persistence rejection, and reconnect tests.

## Fixed scope

- Release anchor: `v1.0.0` at `446f6ddd68d87b28d6d1e2add90c235495149970`.
- Fixed audit head: `e955a0c8d13be6384a08988f40b4331b9b686ce8`.
- Current-main base used for the isolated worktree: `7ad7a4d0d34efc11974d9a31fbd04cdc54069500` (`v1.0.0-234-g7ad7a4d0`).
- Audit branch final pre-integration head: `26345df53e540c88f7ead0528b04bb417500de73` (`v1.0.0-240-g26345df5`).
- History reviewed in `v1.0.0^..e955a0c8`, plus path-relevant changes in `e955a0c8..7ad7a4d0`.
- Required commits inspected with `git show --stat --summary` and their diffs, tests, migrations, contracts, and documentation: `3584bd67`, `bd7fb04e`, `bf795ad1`, `1e339e65`, and `6cb638eb`.
- Later path-relevant fixes reviewed before opening findings: `6dfdea64`, `583eb96f`, `07d66b19`, `ce3438c2`, `f5bb6b40`, `e68110f3`, and merge head `7ad7a4d0`.

The review covered:

- `apps/server/src/core/page/page-template*`, controller DTOs, `PageService`, template persistence, collaboration handler/persistence, Redis/Yjs routing, queue outbox, export, and the AI tool registry;
- `apps/client/src/features/page-template`, routes, editor node views, API/types, policy UI, catalog, publish/history/compare/detach flows, and localized strings;
- `packages/editor-ext` template content, `TemplateField`, and `TemplateManagedBlock` extensions;
- migrations `20260807T130000-synchronized-page-templates` and `20260807T140000-page-template-outbox-and-legacy-cleanup`, current migration ordering, and a clean up/down/up probe;
- `README.md`, archive/export documentation, editor E2E documentation, the queue-outbox runbook, generated route inventory, and AI/RAG documentation where template metadata is exposed.

## Implementation map

| Layer | Implementation and controls |
| --- | --- |
| UI | Space template catalog and picker; regular/synchronized creation; synchronized draft editor; publish preflight; history and compare dialogs; linked-page detach; workspace/space/group policy settings; read-only managed blocks and locally editable fields. |
| API/contracts | Page-template controller and DTOs; page create/update/export actions; workspace, space, and group policy endpoints; revision, preflight, publish, retry, detach, archive, and usage metadata contracts. Mutations are covered by global CSRF and authenticated workspace/space authorization. |
| Service/repository | `PageTemplateService` owns catalog, snapshots, revisions, preflight, publish, sync-run/item state, retries, detach, archive, attachment mappings, and legacy cleanup. `PageTemplatePolicyService` intersects deployment, workspace, space, and group grants. `PageService` and collaboration persistence validate synchronized-instance invariants. |
| PostgreSQL | `page_template_instances`, `page_template_revisions`, `page_template_operations`, `page_template_sync_runs`, `page_template_sync_items`, `page_template_attachment_mappings`, `page_template_publish_confirmations`, workspace/space/group policy tables, legacy migration errors, and `queue_outbox`. Revision and lease fences are persisted transactionally. |
| Redis / collaboration | Yjs live document state, document routing, lease ownership, and reconnect behavior. Invalid synchronized-instance content is rejected before it can enter the live document through the page API; persistence rejection also restores the last valid state for other collaboration paths. |
| Queue / recovery | A durable `queue_outbox` row with `kind=page_template_sync` wakes processing. Sync runs/items use idempotent state transitions and five-minute leases. Startup resumes bounded batches of pending runs and operations; retries create durable work before the queue wake-up. |
| Storage | Template attachment copying is tracked by attachment mappings and cleaned through the established storage abstraction. This audit exercised local storage; S3 was not configured. |
| Export/import | Generated pages are materialized by removing template service nodes. Space exports exclude template catalog pages. Regular generated pages remain independent. |
| AI integration | Built-in tools expose template metadata and usage only after effective workspace/space/page checks. No live model was used; registry and authorization behavior were covered statically and by the existing focused tests. |
| Flags, limits, observability | `PAGE_TEMPLATES_ENABLED` is the deployment gate. Policy actions are `create_template`, `manage_template`, `use_regular_template`, and `use_synced_template`; lower scopes can narrow but not widen. Catalog candidates are bounded at `min(limit * 5, 250)`; sync listings and startup recovery use bounded batches. Structured error codes, run/item/outbox status, attempts, and leases provide recovery evidence; no dedicated page-template metric family was found. |

## Environment and tool provenance

| Tool | Exact source/version | Isolation and data handling |
| --- | --- | --- |
| Git worktree | Repository-native Git | `D:\DevProjects\docmost-qa-G10`, branch `codex/g10-page-template-lifecycle`; unrelated `graphify-out/*` changes were never staged. |
| Node / pnpm | Host Node `v24.16.0`; pinned `pnpm 10.4.0`; production image Node `v22.23.2` | Dependencies installed with the frozen lockfile. Production validation used the repository Dockerfile. |
| Docker Desktop | Server `29.5.3`, Linux/amd64 | Separate Compose project `docmost-g10`; app `3010`, collaboration `3011`, PostgreSQL `55432`, Redis `56379`. The shared installation on port `3000` was not mutated. |
| Docmost image | `docmost-g10-local:72ec5316`; digest `sha256:d57128798d64f08d959e2a812b343a3362c2fa53aeeb95370d70d8efb8dd9953` | Built from commit `72ec5316` after the last production-code fix. Only synthetic audit users/content were used. |
| PostgreSQL | `postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15` | Fresh project volume plus a disposable empty `docmost_g10_migration_probe` database. The probe was dropped after up/down/up validation. |
| Redis | `redis:8-alpine@sha256:978f0e01593e65eed801f2402944efcd936d43b5027e4908a7897baf88ed6241` | Fresh project volume. Redis was stopped and restarted to test durable outbox recovery. |
| Playwright | Repository-pinned dependency and browsers | Chromium, Firefox, mobile Chromium, mobile WebKit, and WebKit media projects. Two simultaneous browser contexts were used by the collaboration and template scenarios. A synthetic local Draw.io route was intercepted in-process; no test data was sent externally. |

No public service, MCP server, proxy, or production credential was used. Canary/QA credentials were loaded from the supplied environment file and were not copied into reports. The artifact sanitizer and secret scanner found no credential values.

## Coverage matrix

| Requirement / scenario | Checks | Result | Evidence |
| --- | --- | --- | --- |
| Deployment/workspace/space/group policies and roles | Static policy intersection review; server policy tests; owner/member direct API denial; browser policy toggle and catalog state | PASS | Focused server tests; screenshots `07`; final browser result JSON |
| Create from scratch / existing page; names/icons/search; space isolation | Service and browser flows; original-content assertions; cross-space API checks | PASS | Template E2E in Chromium and Firefox; service specs |
| Regular templates create independent pages | Browser creates repeated pages; later source edit does not change copies; destination permissions checked | PASS | Final template E2E, both desktop engines |
| Synchronized draft, first publish, preflight, revisions, history, compare | Browser UI and network assertions; revision service tests | PASS | Screenshots `02`-`05`; final E2E |
| Managed blocks read-only; fields survive publish/rename/add/reorder | Editor-extension invariants; repeated publishes; browser field value assertions; direct API bypass | PASS after fixes | `d02612de`, `72ec5316`, `26345df5`; targeted and final E2E |
| Destructive field removal and concurrent values after preflight | Service confirmation/count assertions and stale-confirmation branches; browser confirmation UI | PASS | Focused server suite and publish-preflight browser capture |
| Publish during edits/offline/denied/deleted; retry/idempotency/crash | Sync service tests; two-context browser; API bypass; duplicate outbox delivery; Redis/app restart | PASS after fixes | `b4e5bf2e`, `32baebf3`, `72ec5316`; fault-recovery evidence |
| Detach | Browser/API assertions verify materialized content, stopped future updates, and no silent relink | PASS | Final template E2E and detach service tests |
| Archive | Catalog disappearance, linked-page retention, permission and API checks | PASS | Final template E2E and server tests |
| Cross-space/workspace and cycle/depth protections | Policy/service authorization tests; canonical node validation; existing page-tree and embed-depth controls reviewed | PASS after fix | `d02612de`; server/editor tests |
| Export/import and AI metadata scope | Export unit tests and real browser downloads; service-node scans; space-catalog exclusion; AI registry scope review/tests | PASS after fix | `a5375098`, `26345df5`; final download artifacts |
| Desktop/mobile/two users/accessibility/reload/reconnect | Chromium, Firefox, WebKit, mobile Chromium/WebKit, two contexts, axe output, console/unhandled rejection collection | PASS | Final editor E2E: 23/23; screenshots and console logs |
| Migration lifecycle | Empty database latest, seven downs through template migrations, latest again | PASS | 101 migrations applied; template tables absent after down and restored after up; probe DB deleted |
| Secret leakage | API/artifact/log/queue/DB review; sanitizer and synthetic secret scan | PASS | `artifact-sanitization.json`, `trace-sanitization.json`, `secret-scan.json` |

## Findings

| ID | Severity | Component | Reproducibility and actual result | Root cause | Status / fix |
| --- | --- | --- | --- | --- | --- |
| G10-01 | High | Editor template document model | Reproducible with nested managed containers or duplicate/empty service IDs. Invalid shapes could make field identity ambiguous or move content outside the intended managed-block boundary. | Validation was local to a container and allowed nested containers; service-node IDs were not enforced as globally unique. | Fixed in `d02612de`: canonical top-level structure, global ID uniqueness, nested-container unwrapping, and rejection of invalid instance mutations. |
| G10-02 | High | Synchronization persistence | Reproducible by racing an older and newer revision. An older worker could commit after a newer worker and overwrite the recorded applied revision/content ordering. | Revision freshness was checked before the write but was not fenced atomically in the same database transaction. | Fixed in `b4e5bf2e`: transactional `appliedRevision < revision` fence and stale-item completion semantics. |
| G10-03 | Medium | Export/import boundary | Reproducible in Docmost and presentation exports. Generated synchronized pages retained internal template service nodes, and space exports could include catalog template pages. | Export reused persisted editor JSON without materializing template nodes and did not exclude `templateKind` catalog pages. | Fixed in `a5375098`: materialize generated pages and exclude template catalog entries from space export; documentation and tests updated. |
| G10-04 | High | Page API / live collaboration / sync recovery | Reproducible in Chromium and Firefox. A direct `update-content` mutation of a managed block returned `409` and left PostgreSQL unchanged, but the rejected content remained in the live Yjs document. The next publish failed with `page_template_managed_content_read_only`, leaving the instance in `error`. | Validation happened only during persistence, after the shared live document had already accepted the invalid mutation. Generic rejection handling did not restore the authoritative content early enough for this API path. | Fixed by `32baebf3` and `72ec5316`: restore rejected live updates and validate every active synchronized-instance update before opening/mutating the shared document. Regression E2E committed in `26345df5`. |

### G10-04 reproduction evidence

1. Create and publish a synchronized template with one managed block and one local field.
2. Create a linked page and enter a local field value.
3. Call the authenticated page `update-content` action with a changed managed block, and separately with a nested/duplicate service-node shape.
4. Observe `409 page_template_managed_content_read_only`; query PostgreSQL and confirm the stored page still has revision 1 and the local field value.
5. Before `72ec5316`, publish revision 2. The run failed with item error `page_template_managed_content_read_only` because the live Yjs state still contained the rejected mutation.
6. With `72ec5316`, both bypasses return `409`, the live and persisted states remain valid, revision 2 completes, managed content becomes `Managed v2`, and the local field value survives.

The targeted browser run was `0/2` on `a5375098`, remained `0/2` after only the generic rollback in `32baebf3`, and became `2/2` after the early API fence in `72ec5316`. The full final editor matrix was `23/23`.

## Fault and recovery evidence

- A retained failed run `019fee1d-d470-7498-9f10-b196cfd85430` was retried after app/collaboration restart. Its item completed on attempt 2, the instance became `active`, `applied_revision=2`, and the local field remained intact.
- A completed outbox row was deliberately requeued, Redis was stopped, and the app was restarted. The outbox stayed durable while Redis was unavailable. After Redis restarted, the row completed on attempt 2 without changing the already-completed run or applying the revision twice.
- The current isolated database also preserves failed pre-fix evidence with `page_template_sync_partial_failure` and item code `page_template_managed_content_read_only`; this is synthetic audit data, not a remaining defect in the final build.
- Raw evidence is summarized in `output/audit/g10-page-templates-2026-08-11/fault-recovery-evidence.md`.

## Commands and exit codes

| Command | Exit | Notes |
| --- | ---: | --- |
| `git status --short`; `git rev-parse HEAD`; `git describe --tags --always` | 0 | Captured before work. Only existing `graphify-out/*` changes were dirty in the source tree. |
| `git worktree add -b codex/g10-page-template-lifecycle ../docmost-qa-G10 main` | 0 | Base resolved to `7ad7a4d0`. |
| `corepack pnpm install --frozen-lockfile` | 0 | Required after initial missing-`node_modules` baseline failures. |
| `corepack pnpm --filter ./apps/server test -- --runInBand page-template` | 0 | Baseline 3 suites / 21 tests; final focused set 8 suites / 80 tests. |
| `corepack pnpm --filter ./apps/client test -- page-template` | 0 | Vitest forwarding ran the full client suite: 131 files / 632 tests. |
| `corepack pnpm run test:editor-ext` | 0 | Final: 15 files / 66 tests. |
| Targeted template E2E before API fence | 1 | Chromium and Firefox both reproduced G10-04. This was expected defect evidence. |
| Targeted template E2E after API fence | 0 | Chromium and Firefox: 2/2. |
| Initial full `corepack pnpm run test:editor:e2e` | 1 | 18/23. G10 passed; four Draw.io tests lacked the local shim and one unrelated mobile WebKit click was intercepted. These environment/baseline failures were not treated as G10 defects. |
| Final full `corepack pnpm run test:editor:e2e` | 0 | 23/23 in 4.7 minutes with a synthetic local Draw.io intercept. |
| `corepack pnpm --filter ./apps/server test:e2e -- --runInBand` | 1 | No tests found because the extra separator changed Jest matching. |
| `corepack pnpm --filter ./apps/server test:e2e` (first run) | 1 | Missing built `@docmost/api-contract` host artifact. |
| `corepack pnpm --filter @docmost/api-contract build` | 0 | Built the required workspace runtime artifact. |
| `corepack pnpm --filter ./apps/server test:e2e` (rerun) | 0 | 4 suites / 17 tests against PostgreSQL and Redis. |
| `corepack pnpm run verify:full` | 0 | Build, env/contracts, lint, 224 server suites / 1764 tests, 131 client files / 632 tests, 66 security-server suites / 790 tests, and 6 security-client files / 74 tests. Jest reported a worker force-exit/open-handle warning; no test failed. |
| `corepack pnpm run routes:inventory:check` | 0 | 312 routes. |
| `corepack pnpm run check:rag-docs` | 0 | 15 documented RAG routes. |
| `corepack pnpm run check:comments:en` | 0 | Source and documentation language contract. |
| `corepack pnpm run check:audit-exceptions` | 0 | Exception journal valid. |
| `corepack pnpm run test:text-contracts` | 0 | Generated docs and line-ending contracts. |
| `corepack pnpm run test:rag-sync` | 0 | 16 suites / 159 tests plus 3 contract tests. |
| `corepack pnpm run test:mcp-audit-client` | 0 | MCP audit client checks. |
| `corepack pnpm audit --prod --audit-level high` | 0 | One high advisory is present and already ignored by the repository exception policy; no unignored high/critical advisory failed the command. |
| `docker compose build docmost` for the final production image | 0 | Full production monorepo build completed in the image. |
| Migration latest/down/latest on disposable database | 0 | 101 migrations, template tables removed by down and restored by latest; database then dropped. |
| Artifact sanitizer and secret scanner | 0 | Zero credential findings. |

`verify:release` was not run as a monolithic command because the isolated stack had no configured AI provider/model or AI assistant/context audit environment. Every available non-AI release substage was executed individually, along with the complete editor browser matrix. This limitation does not convert an unexecuted live-AI path into a PASS.

## Scenarios checked without a defect

- Policy grants cannot be widened by a space or group policy beyond the deployment/workspace decision; denied catalog and direct API actions remain denied after reload.
- Regular templates are independent snapshots; repeated use produces separate pages and later source edits do not alter them.
- First synchronized publish, draft autosave, preflight counts, history, compare, field rename/add/reorder, and repeated publishes preserve local field values.
- Detach materializes the page, prevents future updates, and does not silently relink.
- Archive removes a template from the catalog while linked pages retain the last materialized content.
- Space isolation, workspace checks, page permissions, deleted/denied targets, retry, duplicate wake-up, and restart recovery preserve durable state.
- Browser network/console/unhandled-rejection collection found no G10 error in the final Chromium run. Firefox logged only navigation-cancel `NS_BINDING_ABORTED` requests for `/api/users/me`, `/api/spaces`, and `/api/spaces/policy-context`; no page-template action failed.
- Desktop and mobile surfaces had no document-level overflow in the covered viewports; the E2E axe checks completed without a confirmed G10 accessibility defect.

## Fix report and rollback

| Fix commit | Production change | Tests / acceptance | Rollback and observability |
| --- | --- | --- | --- |
| `d02612de` | Canonical top-level managed/field nodes; globally unique service IDs; invalid nested/duplicate/empty instance content rejected. | Three new editor-extension regressions plus full editor/server suites. | Revert commit only if stored noncanonical documents must temporarily be accepted. Rejection uses stable template invariant error codes. |
| `b4e5bf2e` | Atomic revision fence in the persistence transaction; stale sync items are terminal without overwriting a newer revision. | Concurrency and stale-item service tests; duplicate delivery/restart probe. | Revert would reopen stale-worker overwrite. Observe `sync_runs`, `sync_items`, instance revisions, attempts, and lease timestamps. |
| `a5375098` | Materialize generated pages in presentation/Docmost export and exclude catalog entries from space export. | Two export unit tests plus browser download/service-node assertions. | Revert only if a consumer explicitly depends on internal template nodes, which is outside the documented contract. |
| `32baebf3` | Restore authoritative page state after rejected collaboration persistence. | Collaboration handler regression and full collaboration/editor suite. | Revert independently only with another authoritative rollback mechanism. Rejections remain visible through structured logs. |
| `72ec5316` | Validate synchronized page API mutations before the live Yjs document is opened; covers replace, prepend, and append paths. | Three page-service tests; targeted browser 2/2; final browser 23/23. | Revert would restore the live-state poisoning path. Monitor `page_template_managed_content_read_only`, failed sync items, and instance error state. |
| `26345df5` | Browser regression for managed-block and nested/duplicate API bypasses plus exported service-node materialization. | Chromium and Firefox final matrix. | Test-only; no production rollback impact. |

Acceptance criteria after fixes were: invalid managed mutations return `409` without changing persisted or live authoritative content; a subsequent publish completes once; local field values survive; stale revisions cannot overwrite newer ones; exports contain materialized content and no template service nodes; retries and duplicate outbox delivery converge after Redis/app restart. All criteria passed in the final build.

## Remaining risks and untested scenarios

- No live S3-compatible object store was configured; attachment mapping/copy behavior was exercised through local storage and focused tests only.
- No live AI model call was made in the isolated workspace. Template AI metadata/usage authorization was inspected and tested at the registry/service level, but model-mediated display was not claimed as validated.
- A custom raw binary Yjs client was not built to attack a second collaboration node. Direct API bypasses, collaboration rejection/rollback, two-context live editing, reconnect, and offline behavior were covered.
- The complete Cartesian product of publish versus offline edit, ACL revocation, deletion, and app/Redis failure was not executed in the browser. The high-risk combinations were divided between browser, service/integration, and controlled fault checks; unexecuted combinations remain residual risk.

## Evidence and commits

Evidence root: `D:\DevProjects\docmost-qa-G10\output\audit\g10-page-templates-2026-08-11`.

- Final browser report: `editor-e2e-final/playwright-html/index.html` and `editor-e2e-final/playwright-results.json`.
- Reproduction reports: `editor-e2e-targeted`, `editor-e2e-targeted-after-live-rollback`, and the passing `editor-e2e-targeted-after-api-guard`.
- Browser screenshots: `screenshots/01` through `screenshots/07`.
- Console, axe, trace, video, and download artifacts are under each browser result directory.
- Sanitization: `editor-e2e-final/artifact-sanitization.json`, `trace-sanitization.json`, and `secret-scan.json`.
- Fault/recovery summary: `fault-recovery-evidence.md`.

Production commits: `d02612de`, `b4e5bf2e`, `a5375098`, `32baebf3`, and `72ec5316`. Test-only commit: `26345df5`. No push, pull request, tag, or release was created.
