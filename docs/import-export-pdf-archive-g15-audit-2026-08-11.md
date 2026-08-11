# G15 import, export, PDF, and Docmost archive audit — 2026-08-11

## 1. Verdict

**PASS WITH RISKS after fixes.** No release-blocking defect remains in the G15
scope. Six reproducible defects were fixed, covered by regression tests, rebuilt
into a production image, and exercised against an isolated PostgreSQL, Redis,
queue, and local-storage stack.

Residual release risk is limited to the following explicit gaps:

- the repository editor acceptance gate still has four reproducible failures in
  the neighboring Draw.io edit/copy-on-write surface (owner: editor/G13). The
  iframe is never created in Chromium or Firefox, even when its URL is locally
  intercepted; 19 of 23 editor browser tests pass on the final G15 image;
- a full 200 MiB upload-limit archive and an S3-backed attachment failure were
  not run. The real API was exercised with 10,001 entries, a 32 MiB compressed
  bomb with a forged size, corrupt CRC/data, and a local-storage failure;
- two independent browser roles were tested sequentially in the in-app browser
  and simultaneously through independent API sessions. The selected in-app
  browser did not expose isolated simultaneous browser contexts.

`verify:release` was not reported as green because it includes the failing
Draw.io editor gate and requires a configured production-like Draw.io endpoint.
Its relevant build, route, security, unit, and browser sub-stages were run
separately and are recorded below.

## 2. Fixed scope and history

### Git boundary

- Fixed audit history boundary: `v1.0.0^..e955a0c8`.
- Release tag: `v1.0.0` at
  `446f6ddd68d87b28d6d1e2add90c235495149970`.
- Audit head: `e955a0c8d13be6384a08988f40b4331b9b686ce8`.
- Work started from local `main`
  `7ad7a4d0d34efc11974d9a31fbd04cdc54069500`
  (`v1.0.0-234-g7ad7a4d0`).
- Latest local-main merge point on the G15 branch:
  `57c1e39b544dd196f3558bb26ce057fb9f523444`
  (`v1.0.0-271-g57c1e39b`).
- Local `main` had advanced to
  `466aff91aae0ff69cf96228ae4d3f8dac4d186e1` before integration.
- The final local-main integration commit is recorded in the task handoff,
  because a committed Markdown file cannot contain the hash of its own final
  containing commit.

The two required history commits were inspected with `git show --stat
--summary`, full diffs, tests, documentation, and contracts:

- `01d3e35a` — Mermaid export policy isolation;
- `a62c2b7b` — database view preservation and archive hardening.

Later relevant changes were also inspected before testing and were not
reopened or reverted: `f5bb6b40`, `ce3438c2`, `7b1831cc`, `6cb9d8ab`,
`f2f1f01d`, `2aa6e519`, `6f65ae26`, `bd3b0594`, `7c104a0b`, and the newly
merged `fddace4d`/`a5375098` export and template fixes.

### Implementation map

| Surface | UI | API and contract | Service/repository | Runtime systems and recovery |
| --- | --- | --- | --- | --- |
| Page export | export modal and page actions | `POST /api/pages/actions/export` | `PageExportController` -> `ExportService`; root ACL plus descendant filtering through `PageAccessService` | PostgreSQL page/database snapshots; storage reads; streamed ZIP response; PDF Chromium renderer |
| Space export | space menu and export modal | `POST /api/spaces/actions/export` | `SpaceExportController` -> `ExportService.exportSpace` | full-space ACL; storage attachments; no background job |
| Database export | database export UI | `POST /api/databases/:databaseId/export` | `DatabaseController`/`DatabaseService` -> `ExportService` | current presentation view uses filters/sort/visible properties; Docmost uses canonical rows and saved views |
| PDF | page/database export format | same export routes | `HtmlPdfRendererService` plus `ExportService` materializers | `/usr/bin/chromium`; `PDF_RENDER_TIMEOUT_MS`; request interception allows only `data:`, `about:blank`, and same-origin public attachment URLs |
| Archive preview | `Import pages` dialog | `POST /api/pages/actions/import-zip/preview` | `ImportController` -> `ImportService.inspectDocmostArchive` | uploaded ZIP stored under workspace imports; raw `yauzl` validation, actual-byte streaming budget, then JSZip CRC and schema/checksum validation |
| Confirm/cancel/report | preview confirmation, persisted polling, recent operations | `POST /api/pages/actions/import-zip/{confirm,cancel}`, `POST /api/file-tasks/info`, `POST /api/file-tasks/import-reports` | `ImportService`, `FileTaskQueryService`, `FileTaskProcessor`, `DocmostArchiveImportService` | PostgreSQL `file_tasks`; BullMQ in Redis db0; local/S3 storage; atomic committed task fence; worker retry/stalled recovery |
| Attachments | archive options and rendered nodes | archive manifest contract | `ImportAttachmentService`, `DocmostArchiveImportService`, `StorageService` | three fresh-stream upload attempts, sanitized retry log, cleanup on failure, transaction rollback |

No feature flag gates core import/export. Effective deployment limits were
`FILE_UPLOAD_SIZE_LIMIT=50mb`, `FILE_IMPORT_SIZE_LIMIT=200mb`, archive limits of
10,000 entries, 250 MiB per uncompressed entry, 512 MiB cumulative
uncompressed data, and path depth 64. PDF used Chromium with a 60,000 ms
timeout. No dedicated import/export cache was found. Persisted import recovery
uses PostgreSQL/BullMQ plus a per-space client task identifier. Security logs
emit normalized reasons and never log hostile payload bodies; no dedicated G15
metrics beyond task state and structured logs were found.

### Files, schemas, migrations, contracts, and docs read

- `apps/server/src/integrations/import/{import.controller.ts,file-task.controller.ts,processors,file-task.*,services,utils}`;
- `apps/server/src/integrations/export/{export.controller.ts,export.service.ts,html-pdf-renderer.service.ts,copy-markdown-with-comments.service.ts,dto,utils.ts}`;
- `apps/server/src/integrations/storage`, attachment services/utilities,
  queue processors, space/page ACL services, database export services;
- `apps/client/src/features/page/components/import-modal.tsx`, page/file-task
  services and hooks, database export service, common export modal, Mermaid
  sanitizer, and related tests;
- `packages/api-contract/src/docmost-archive.ts` and generated route inventory;
- migrations `20250521T154949-file_tasks.ts`,
  `20260723T120000-file-task-import-options-and-result.ts`, and the legacy task
  cleanup in `20260730T150000-remove-legacy-ee-imports-and-ai-search.ts`;
- `docs/docmost-archive-format.md`, `ARCHITECTURE.md`, routing documentation,
  security runbook, Docker/env contracts, and the relevant history diffs.

No migration or public contract change was required by the fixes.

## 3. Environment and external tools

All document data was synthetic and remained local. No document or PDF was
sent to a SaaS conversion service.

| Tool/runtime | Provenance and exact version | Use and isolation |
| --- | --- | --- |
| Docker Desktop | official Docker Desktop `29.5.3`, local Windows 11 host | isolated compose project `docmost-g15`, ports `127.0.0.1:3015/3016`, separate DB/Redis/storage volumes |
| Final tested application image | local build `docmost-g15:e3f1ca28`, manifest digest `sha256:bf8b3c1252781a62322f57694aa76adaadefdfe311db7ffb361c040ad54f33f2` | production Dockerfile, Node 22 runtime, no external registry push |
| PostgreSQL | official `postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15` | isolated volume; setup and independent assertions only |
| Redis | official `redis:8-alpine@sha256:978f0e01593e65eed801f2402944efcd936d43b5027e4908a7897baf88ed6241` | isolated BullMQ/rate-limit state; only isolated test keys were cleared |
| Host Node/pnpm | Node `v24.16.0`, Corepack pnpm `10.4.0` | repository-native harnesses and tests |
| Playwright | repository dependency `1.62.1` | repository editor E2E and browser matrices; artifacts sanitized locally |
| Chromium | Debian build `151.0.7922.108` in application image | PDF rendering and resource interception |
| Poppler | bundled local `pdftoppm` `26.05.0` | rendered every generated PDF page to PNG for visual inspection |

No new MCP server or external dependency was installed. Generated malicious
ZIP files used repository dependency JSZip plus raw central-directory mutation.

## 4. Coverage matrix

| Requirement/scenario | Static/unit/integration/browser/fault/security check | Result | Evidence |
| --- | --- | --- | --- |
| 1. Page export: Markdown, HTML, PDF, Docmost; headings, Unicode, table, Mermaid, media, synced content, page break, deep children | real API export; independent ZIP/CRC/content inspection; all PDF pages rendered; export unit tests cover comment markers | PASS | `artifact-inspection.json`, artifacts directory, PDF and screenshots 06/11 |
| 2. Database current view versus canonical archive | current-view Markdown asserted one filtered row, sort/visible fields; Docmost asserted all rows, properties, views | PASS | database artifacts and `artifact-inspection.json` |
| 3. Space round trip | owner UI/API export/import into empty space; 40 preview pages, 3 databases, 4 rows, 3 referenced attachments, 1 term, 2 labels; imported media dimensions verified | PASS | screenshots 08-11, runtime import reports |
| 4. Preview, confirm, cancel, recent/progress, reload/resume, duplicate | preview counts independently matched; cancel removed task/file; immediate reload restored result; duplicate created a clean second copy; client persistence tests | PASS | screenshots 08-10, `runtime-import-1.json`, pending-import tests |
| 5. Hostile ZIP | traversal, absolute, symlink, duplicate, newer schema, corrupt data/CRC, depth 65, 10,001 entries, forged size/compressed bomb | PASS after G15-01/G15-06 | `runtime-hostile-archives.json`; all returned 400 in 9-28 ms |
| 6. Attachment failure after retries | target file directory made read-only; two retry log events (three attempts); task failed; target remained 164 pages/12 attachments; permission restored | PASS after G15-03 | task `019feff1-8b27-7045-96df-3abe0cb495d0`, container/DB assertions |
| 7. PDF renderer | 3 A4 pages visually inspected: wide table, Mermaid, Draw.io/Excalidraw SVG, Unicode fonts, synced block and page break; resource allowlist unit/security tests | PASS WITH LIMIT | live external-URL canary fetch was not repeated; allowlist behavior is unit/security evidence |
| 8. Mermaid policy regression | shared sanitizer tests, security suite, real sanitized diagram in editor/export/PDF | PASS | security 74 client tests, screenshot/PDF |
| 9. ACL/roles and metadata leak | owner plus explicit target-space reader; allowed readable child export 200; root/space export, target import, foreign task info/confirm 403; reader UI omitted all mutation menus | PASS after G15-02 | `runtime-acl.json`, screenshot 14 |
| 10. Concurrency/restart/idempotency | two simultaneous imports both succeeded with exactly 41 pages/3 DB/4 rows/3 attachments; forced app restart from processing recovered to success with page delta 41 | PASS after G15-03 | `runtime-import-2.json`; restart task `019feff2-75c5-75f3-96df-9ea50801cb9d` |
| 11. Independent file inspection | every ZIP entry CRC, safe path and uniqueness verified independently; hashes captured; PDF extracted and rendered | PASS | `artifact-inspection.json`, SHA-256 values below |

Produced artifact SHA-256 values:

- page Markdown: `30114cb5f7d6cec34dbc4c59ac2f8f23995b71d8af52961e9451e6ccafc473b7`;
- page HTML: `3b97e80aa7dcfb13e4f8023b2b76cd656d8afa3bfbefd7b8bb097addc569304a`;
- page PDF archive: `417ce6821c7289b79a9c8fedc38063ef71bdde192327682d8b8e56d898bb7ca2`;
- page Docmost: `cfb374b36607919588bc2854b5ae8b4c6695db1f9b687dd4870a03e174ed7e7c`;
- database view Markdown: `92bb53879258d179f158043ea9921ec9b7a0a9c35384560684c2d6370b7d8394`;
- database Docmost: `85f1da92b5e33f579ade331c2bbb4f0083c7f9b3c44a728fd4ee0ff4c9db0a23`;
- space Docmost: `0963eb72329cbf9cd3c9a8b77f4fcbbaf5f592eaf5fd302bbdfd0d0294a56096`.

## 5. Commands and exit codes

Read-only `git status`, `git rev-parse`, `git describe`, `git log`, `git show`,
`git diff`, `rg`, route/schema inspection, `docker inspect`, and SQL read queries
all exited 0 unless explicitly noted below. The material execution log is:

| Command | Exit | Result |
| --- | ---: | --- |
| initial `git status --short`, `git rev-parse HEAD`, `git describe --tags --always` | 0 | only pre-existing `graphify-out/*` changes; preserved |
| required history `git show --stat --summary` and full diffs for `01d3e35a`, `a62c2b7b` | 0 | implementation/tests/docs reviewed |
| baseline targeted server import/export | 0 | 8 suites, 72 tests |
| final `corepack pnpm --filter ./apps/server test -- --runInBand integrations/import integrations/export` | 0 | 10 suites, 84 tests after merging the current `main` into the audit branch |
| targeted archive, durability, processor, file-task ACL tests during fixes | 0 | all selected suites passed |
| final `corepack pnpm run test:security` | 0 | server 66 suites/791 tests; client 6 files/74 tests |
| client unit suite after import-modal fixes | 0 | 132 files/634 tests |
| targeted server/client ESLint | 0 | no findings |
| `corepack pnpm server:build` and `corepack pnpm client:build` | 0 | passed sequentially |
| one earlier parallel Nx build | 1 | baseline tooling race: concurrent WASM context; sequential retry passed |
| `docker build -t docmost-g15:e3f1ca28 .` | 0 | complete production build, final digest recorded above |
| isolated `docker compose ... up -d` and health polling | 0 | app/collab/db/redis healthy on 3015/3016 |
| API artifact generation and `node .../inspect-artifacts.mjs` | 0 | seven archives independently verified |
| `node .../hostile-archive-runtime.mjs` | 0 | nine hostile classes rejected with 400 |
| `node .../acl-runtime-audit.mjs` | 0 | owner/member plus explicit reader space role, no metadata leak |
| `node .../runtime-import-audit.mjs` with count 2 | 0 | two concurrent successes |
| read-only-storage fault run | 0 | task failed after retries; DB counts unchanged; mode restored 755 |
| processing-state `docker restart -t 0` recovery run | 0 | processing -> success, exactly 41 new pages |
| `corepack pnpm run routes:inventory:check` | 0 | 312 routes current |
| `corepack pnpm run check:comments:en` | 0 | passed again after report creation |
| shared-stack `corepack pnpm run test:editor:e2e` | 1 | 17/23; Draw.io x4 plus two transient failures |
| isolated final-image editor E2E with local Draw.io route | 1 | 19/23; only reproducible Draw.io x4 remained |
| artifact sanitizer and scanner | 0 | 0 credential findings; canary absent from API, logs, DB, Redis, storage |

The targeted editor rerun also failed the same four Draw.io assertions, proving
the failure is stable rather than a G15 change. The initial Firefox navigation
abort and mobile WebKit toast interception passed on the isolated rerun and are
classified as test flakiness, not findings.

## 6. Findings

| ID | Severity | Component | Reproducibility | Expected / actual | Root cause | Status / fix |
| --- | --- | --- | --- | --- | --- | --- |
| G15-01 | High | ZIP preview/extraction | 100% with raw duplicate, absolute or symlink entry | reject whole archive / JSZip could collapse or extraction could skip ambiguous entries | validation occurred after normalization and did not preserve all raw central-directory semantics | fixed `351e7433` |
| G15-02 | High | file-task metadata ACL | 100% with a same-workspace foreign task ID | creator/settings manager only / a space member could query preview, result and storage metadata | query checked workspace/space but not task ownership or settings-management ability | fixed `aa7a151a` |
| G15-03 | High | archive commit and attachment lifecycle | deterministic unit fault; live storage fault and restart | no broken references, atomic terminal state, replay-safe recovery / upload was single-shot and terminal state could be downgraded after committed data | attachment upload lacked bounded fresh-stream retry/cleanup; task success was outside the domain transaction | fixed `285d3820` |
| G15-04 | Medium | import UI recovery | 100% reload/poll failure | resume active task and retry transient poll / modal forgot the task and stopped after one poll error | task ID existed only in component memory and terminal/error cleanup was eager | fixed `32976d19` |
| G15-05 | Low | import dialog | 100% at 1440x900 | full `Choose archive` label / flex shrink clipped it to `Choose arch` | action button was allowed to shrink beside descriptive text | fixed `81bbcc60` |
| G15-06 | High | ZIP bomb/CRC validation | 100% with forged central size | enforce actual byte budget before expensive CRC / `JSZip.loadAsync(checkCRC32)` could decompress before the later budget | initial `yauzl` pass inspected metadata only and never streamed actual entry bytes | fixed `e3f1ca28` |

## 7. Finding evidence and impact

### G15-01 — ambiguous archive entries

Upload a ZIP whose raw central directory contains a duplicate
`docmost-data.json`, an absolute name, or a Unix symlink. Before the fix, the
library representation could hide ambiguity or extraction could partially
continue. The fix validates every raw entry before JSZip and fails closed.
Runtime evidence after the fix: duplicate, absolute, traversal, and symlink all
return 400, with no committed task/content. Impact was archive confusion,
unexpected materialization, and defense-in-depth traversal risk.

### G15-02 — file-task metadata authorization

As owner, create a target-space preview. As another workspace member/reader,
call `POST /api/file-tasks/info` and confirm with the owner's task ID. Before the
fix, membership was sufficient to expose preview/result/file-path metadata.
After the fix both requests return 403, `leakedTaskFields=false`, while the task
creator retains access. Impact was cross-user metadata disclosure and operation
probing within one workspace.

### G15-03 — atomic import and attachment failure

The targeted tests reproduce an upload failure on every attempt and a late
processor exception after the domain transaction. The live fault test made only
the target workspace `files` directory read-only. It observed two retry log
events (three attempts), terminal `file_task_processing_failed`, no raw EACCES
in logs, no page/attachment delta, and restored permissions. A separate forced
container restart caught the task in `processing`; BullMQ recovery completed it
once with exactly 41 new pages. Impact was broken attachment references,
misleading terminal state, and duplicate replay after crashes.

### G15-04 — reload and transient polling

Start an import in the dialog and reload immediately. Before the fix the modal
lost its task and stopped polling after a transient request error. The client now
stores a per-space task ID, restores and polls it after reload, retries transient
failures, and clears only at a terminal state/cancel. Two unit tests cover the
restore and retry branches; screenshot 09 shows the restored completion report.

### G15-05 — clipped action label

At 1440x900, open the space import dialog. Screenshot 07 records `Choose arch`.
After `flexShrink: 0`, screenshot 12 and DOM geometry record the full label with
button `clientWidth=scrollWidth=132`; mobile 390x844 also remains within the
375 px dialog.

### G15-06 — unmetered CRC decompression

Create a highly compressible entry, change its central-directory uncompressed
size to one byte, and submit preview. `JSZip.loadAsync(checkCRC32)` previously
ran before actual-byte accounting. The new first pass opens every non-directory
entry through `yauzl`, meters actual entry and total bytes, and rejects a size
lie before JSZip. A 32 MiB zero payload compressed to 32,731 bytes was rejected
in 9 ms with 400. Impact was unauthenticated-by-content resource exhaustion for
an authenticated importer.

## 8. Checked scenarios without a defect

- current database presentation view versus full Docmost database archive;
- all generated ZIP CRCs, unique names, relative paths, attachment payloads,
  and checksums;
- Unicode, wide tables, Mermaid, Draw.io/Excalidraw rendered SVG, synced-block
  materialization, explicit PDF page break, and deep descendants;
- template catalog exclusion and ordinary exported template instances after
  merging the G10 fix;
- forbidden descendant pruning in export service tests and role-based root/full
  space checks in live API;
- preview counts, cancel deletion, recent reports, reload, duplicate import,
  concurrent import, worker restart, and attachment partial failure;
- no console errors or unhandled rejections in the G15 owner/reader browser
  flows;
- no canary in response bodies, browser artifacts, application logs, relevant
  DB rows, Redis dumps, or storage files;
- generated route inventory and documentation contract remained current.

## 9. Limitations and untested scenarios

- S3 was not configured; storage behavior was tested through the production
  storage abstraction with the local driver and faulted filesystem.
- A real archive near the 200 MiB compressed upload limit was not submitted.
  Entry count, depth, 32 MiB compression shape, forged declared size, streaming
  budgets, and upload-limit code paths were covered without consuming hundreds
  of MiB.
- A live external HTTP resource canary was not added to the PDF fixture. The
  renderer's request allowlist and external blocking are covered by focused
  tests; the generated PDF was independently inspected.
- PostgreSQL migrations were inspected but not rolled down/up because G15 made
  no schema change; destructive migration replay would not validate these
  code-only fixes.
- Simultaneous isolated browser contexts were not available in the selected
  in-app browser. Independent owner and reader sessions were still verified by
  browser plus API.
- The four Draw.io editor iframe failures remain owned by the editor/G13 scope.
  They do not affect static Draw.io/Excalidraw payload portability or PDF
  rendering proven here, but they prevent a green repository-wide editor gate.

## 10. Fix report, rollout, rollback, and acceptance

All fixes are minimal code changes with no migration or public-contract change.

- `351e7433`: raw central-directory validation and strict extraction. Roll back
  by reverting the commit; doing so reopens unsafe ambiguity and is not
  recommended. Acceptance: all malicious raw-name cases return 400 before task
  creation.
- `aa7a151a`: creator/workspace-manager file-task authorization. Acceptance:
  creator/manager allowed; foreign member denied without task fields.
- `285d3820`: upload retry/cleanup plus transactional success fence.
  Observability: `docmost_archive_attachment_upload_retry` and terminal
  privacy-safe file-task error. Acceptance: failed uploads leave no pages or
  references; restart/retry commits once.
- `32976d19`: persisted import task recovery and polling retry. Rollback affects
  only recovery UX. Acceptance: reload resumes and a transient poll error is
  retried.
- `81bbcc60`: non-shrinking archive action button. Acceptance: full label at
  desktop/mobile geometry and no overflow.
- `e3f1ca28`: actual streaming budget before CRC validation. Observability:
  normalized `[security][zip-entry-rejected] reason=invalid-entry-data` without
  payload content. Acceptance: a forged small central size is rejected before
  JSZip CRC work.
- `179c92e2`: current archive security/recovery behavior documented.

Rollout requires only the new application image; no migration or cache flush is
needed. Existing successful archives remain compatible with schemas 2, 3, and
4. Rollback is a normal application-image rollback, but G15-01, G15-02,
G15-03, and G15-06 are security/data-integrity fixes and should not be rolled
back without compensating controls.

## 11. Evidence, commits, and test-only material

Evidence root (ignored, retained locally):
`output/audit/g15-2026-08-11`.

Key files:

- `artifact-inspection.json` and `artifacts/*.zip`;
- `pdf/g15-portable-root.pdf` and rendered page PNGs;
- `runtime-hostile-archives.json`, `runtime-acl.json`,
  `runtime-import-1.json`, `runtime-import-2.json`, and
  `restart-import-task.json`;
- screenshots `07-import-modal.png`, `08-import-preview.png`,
  `09-import-complete-after-reload.png`,
  `11-duplicate-import-canonical-media.png`,
  `12-import-modal-post-fix.png`, `13-import-modal-mobile.png`, and
  `14-reader-space-no-actions.png`;
- `editor-e2e/playwright-results.json` and four retained Draw.io failure traces;
- `trace-sanitization.json` and `secret-scan.json` (`clean=true`).

Production/documentation commits owned by G15:

1. `351e7433 fix(import): reject ambiguous archive entries`
2. `aa7a151a fix(import): restrict file task metadata access`
3. `285d3820 fix(import): fence committed archive restores`
4. `32976d19 fix(import): resume archive progress after reload`
5. `81bbcc60 fix(import): keep archive action label visible`
6. `e3f1ca28 fix(import): meter archive data before CRC validation`
7. `179c92e2 docs: document hardened archive lifecycle`

All harness scripts, generated fixtures, traces, screenshots, ZIPs, PDFs, and
runtime JSON under the evidence root are test-only and ignored. They are not
staged or committed. No credential value is present in the report. The
pre-existing `graphify-out/*` modifications were preserved and never staged.
