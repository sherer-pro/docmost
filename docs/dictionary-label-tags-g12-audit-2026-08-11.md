# G12 Dictionary, Labels, and Inline Tags Audit - 2026-08-11

## Verdict

**PASS WITH RISKS.** Eight reproducible defects owned by G12 were fixed and revalidated. No remaining G12 release blocker was found in the exercised dictionary lifecycle, JSON import/export, incremental highlighting, label assignment/registry, inline-tag, role, tenant-isolation, concurrency, fault, and browser paths.

The residual risks are external to the G12 implementation: the isolated deployment does not pass `DRAWIO_URL`, so two unrelated Draw.io editor tests fail before their iframe is created; requests already waiting on PostgreSQL did not terminate within a 90-second outage probe even after the database recovered; and axe reported two contrast violations on unrelated gray Page Details badges. True assistive-technology announcements, physical touch hardware, and Typesense mode were not exercised.

## Fixed scope and history

- Release anchor: `v1.0.0` at `446f6ddd68d87b28d6d1e2add90c235495149970`.
- Fixed audit head: `e955a0c8d13be6384a08988f40b4331b9b686ce8`.
- Current-main base used for the isolated worktree: `b13bee7d8602c60e314c79961ca2dc24a412dc9d` (`v1.0.0-282-gb13bee7d`).
- Audit branch final production-code head before this report: `3c68c855786a09721dcebd2c95c5d488d4f91315` (`v1.0.0-290-g3c68c855`).
- Local `main` advanced concurrently to `71019061bebb28d85f21dda4db9b884fade43e1b` before integration. Its unrelated changes were preserved.
- Final audit/report and local-main integration heads are recorded in the final section after merge.
- The fixed history window `v1.0.0^..e955a0c8` and path-relevant changes in `e955a0c8..b13bee7d` were reviewed.
- Required commits were inspected with `git show --stat --summary`, full diffs, tests, migrations, contracts, and documentation: `694b47be49e3ac99f2d053655d48ab700fffa669` and `e800f87a3b3d69224e23c6d99bb5be0a74bae4a7`.
- Later path-relevant commits inspected before opening findings: `3ec4591e`, `ca49d464`, `bd9061ce`, `f35408e5`, `175953bd`, `c49a63ac`, and `6f65ae26`. Existing fixes were not reopened or reverted.
- Earlier baseline history was reviewed for dictionary, label, tag, workspace settings, and related migration paths, including `20260509T120000-dictionary-terms`, `20260526T122000-labels`, `20260705T130000-space-scoped-labels`, and `20260806T210000-normalize-workspace-json-settings`.

The source review covered:

- `apps/server/src/core/dictionary`, `apps/server/src/core/label`, their DTOs, controllers, services, repositories, abilities, and specs;
- `apps/client/src/features/dictionary`, page-label components, space settings, workspace tag settings, search filters, database-cell rendering, and websocket query invalidation;
- `apps/client/src/features/editor/components/tag` and `packages/editor-ext/src/lib/tag`;
- Docmost archive import/export label and dictionary materialization paths;
- dictionary/label migrations, current route inventory, locale resources, repository runbooks, and browser test contracts.

## Implementation map

| Layer | Implementation and controls |
| --- | --- |
| UI | Space dictionary route and term modal; JSON import/export confirmation and notifications; highlighting in ProseMirror, Markdown, textarea/overlay, and database text cells; Page Details label picker; space label registry; workspace built-in TBD/TODO/DONE registry; search filters for labels and inline tags. |
| API and contracts | Authenticated `dictionary-terms` list/create/update/delete/import/export routes; page-label add/remove/list/search routes; space-scoped label registry/list/rename/delete routes; space `dictionaryEnabled` setting; workspace tag settings. Global CSRF applies to mutations. DTO limits and the generated route inventory are the wire contract; no shared `api-contract` schema was changed. |
| Authorization | Dictionary reads require space page-read ability; term writes require space page-manage ability; import/export additionally require workspace `admin|owner`. Page-label assignment/removal is checked against page access. Registry mutation requires space Manage Settings. Resource lookups bind term/label IDs to workspace and space before mutation. |
| Service and repository | `DictionaryService` normalizes visible aliases with NFKC, whitespace collapse, and locale lowercase lookup, then applies transactional alias uniqueness. `LabelService` normalizes names, resolves page access before pagination, and owns registry lifecycle. Repositories scope every query by workspace/space and use database transactions for multi-row changes. |
| PostgreSQL | `dictionary_terms`, `dictionary_term_aliases`, `labels`, and `page_labels`. Alias uniqueness is enforced per space by `dictionary_term_aliases_space_normalized_unique_idx`; page-label pairs are unique and cascade on label/page deletion; labels were backfilled and constrained to spaces by `20260705T130000-space-scoped-labels`. |
| Redis and cache | No dictionary or label domain cache is stored in Redis. Client React Query data is invalidated through the existing websocket space-query subscription. Redis was exercised only as shared realtime/queue infrastructure and is not required for the core dictionary API read path. |
| Collaboration | ProseMirror/Yjs updates feed the dictionary extension. The incremental plugin remaps existing decorations and rescans only changed text blocks; dictionary changes or hydration rebuild the index/decorations. Two simultaneous browser contexts exercised typing, paste, undo/redo, and remote updates. |
| Queue, jobs, storage, external systems | Dictionary term CRUD/import and label/tag operations are synchronous and do not enqueue jobs or write storage. Docmost archive import is the only background import integration reviewed; it now normalizes restored labels and aliases consistently. No linguistic SaaS or external document upload was used. |
| Flags and limits | Space setting `settings.dictionary.enabled` gates navigation/highlighting. Workspace `settings.tags.disabled` gates built-in editor tags. Terms/forms are 255 characters, definitions 20,000, at most 100 forms per term, and at most 1,000 terms per JSON import. Page-label add accepts 1-25 names of at most 100 characters. General Fastify body limits rejected the oversized request with `413`. |
| Matching and exclusions | Client matching uses NFKC, case-insensitive lookup, Unicode-aware boundaries, longest-first alternation, and original-offset mapping. Editor scanning skips code/code-block/link marks; Markdown skips code and links. Tooltips are portals with keyboard/focus handling and named dialogs. |
| Observability and recovery | Validation and authorization use structured HTTP status/error responses; duplicate imports are atomic. No dedicated dictionary/label metrics or background recovery loop exists. React Query/websocket invalidation and reload recover UI state. PostgreSQL outage logs expose health/dependency failure without logging canary values. |

## Environment and tool provenance

| Tool | Exact source/version | Isolation and data handling |
| --- | --- | --- |
| Git worktree | Repository-native Git | `D:\DevProjects\docmost-qa-G12`, branch `codex/g12-dictionary-labels`; the source checkout's unrelated `graphify-out/*` changes were never staged or modified. |
| Node / pnpm | Host Node `v24.16.0`; pinned `pnpm 10.4.0`; production image Node `v22.23.2` | Dependencies came from the repository lockfile. Production validation used the repository Dockerfile. |
| Docker Desktop | Client/server `29.5.3`, Linux/amd64 engine | Separate Compose project `docmost-g12`, app `127.0.0.1:3200`, collaboration `127.0.0.1:3201`, private PostgreSQL/Redis/volumes. The shared port-3000 stack and other contour projects were not mutated. |
| Docmost image | `docmost-g12:3c68c855`; digest `sha256:394c57725b9c0f58fdc93cb758d1c0677bbbe913160d8f48cab575fb63462b1e` | Built after the final production-code fix. The isolated database had 101 migrations; all G12 data was synthetic or cloned QA data. |
| PostgreSQL | Official `postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15` | Private project volume and Docker network. Controlled stop/start was used for failure and recovery testing. |
| Redis | Official `redis:8-alpine@sha256:978f0e01593e65eed801f2402944efcd936d43b5027e4908a7897baf88ed6241` | Private project volume and Docker network. Controlled stop/start did not expose data outside the host. |
| Playwright / axe | Repository-pinned `@playwright/test 1.62.1` and `@axe-core/playwright 4.12.1` | Chromium and Firefox were used, including two simultaneous contexts and a 560x1000 mobile viewport. Browser data stayed on localhost. |
| Graphify | `graphifyy 0.9.33`, official source `https://github.com/Graphify-Labs/graphify` | Existing local graph only, used as a navigation aid; important claims were re-read in source. The saved G12 feedback was produced and then all generated graph changes were removed from the worktree. |

No new package, MCP server, remote browser, public service, proxy, or external linguistic service was installed or used. QA cookies were loaded only from the supplied `.env.qa`; their values are absent from this report. Evidence was sanitized and scanned before retention.

## Coverage matrix

| Requirement / scenario | Static / unit / integration / browser / fault / security check | Result | Evidence |
| --- | --- | --- | --- |
| Enable/disable dictionary and role permissions | Space setting and ability review; owner toggle; reader/writer direct API denial; reload | PASS | API audit; final Playwright; focused controller/service tests |
| Create/update/delete, forms, descriptions, duplicate/case/NFKC | DTO/repository review; unit tests; real API CRUD and duplicate checks | PASS | 24 focused server tests; API audit assertions |
| Boundaries, punctuation, hyphens, Cyrillic/Latin, mixed case, forms, overlap, longest match | Matcher tests plus browser text fixtures | PASS | Client unit suite; final Chromium/Firefox scenarios |
| Links and inline/block code exclusion | Editor and database renderer tests plus real browser page | PASS after fix | `686f578b`; final Playwright |
| Incremental typing, paste, undo/redo, collaboration, hydration | Extension state/assertion review; unit tests; two contexts | PASS | `694b47be`, `e800f87a`, `847a4002`; final Playwright |
| Large dictionary/document responsiveness | 10,000-term matcher unit probe; 5,000-term real browser set and small edit | PASS WITH MEASURED RISK | Unit index `66.99 ms`, match `160.35 ms`; Chromium edit `158 ms`, Firefox edit `251 ms` |
| Dictionary modal/tooltips keyboard, mouse, focus, mobile | Browser pointer/Enter/Escape/focus return; 560x1000 layout; accessible names; axe | PASS after fixes | `95b9c42d`, `847a4002`, `4e9238a8`; screenshots `02`, `05`, `06` |
| JSON export/import round trip, invalid schema, duplicate, oversize, partial failure, counts, isolation | Client parser tests; API round trip; 1,001-term DTO rejection; `413`; atomicity and cross-space assertions | PASS | Dictionary controller/service tests and API audit |
| Labels create/assign/remove/search/access | Unit/API/browser with owner, writer, and reader; reload and cross-space checks | PASS after fix | `a39bc420`; final API and browser runs |
| Label registry rename/delete/conflict/concurrent admins | New API/service/repo tests; 30 API assertions; real UI rename/delete/focus/mobile | PASS after fixes | `388a82b6`, `3c68c855`; screenshots `08`-`10` |
| Database-row label display | Renderer unit test and browser/editor smoke | PASS after fix | `686f578b`; full client suite |
| TBD/TODO/DONE rendering, settings, copy/paste/serialization, locale, search | Editor-extension unit tests; workspace settings UI; existing node; combined label+TODO search | PASS | Editor-ext 66 tests; browser search/settings evidence |
| Cross-space/workspace isolation and deleted cleanup | Resource scopes, direct API bypass, page/label cascade query | PASS | API audit and final PostgreSQL assertions |
| Concurrent admins and duplicate imports/renames | Concurrent requests and unique-index behavior | PASS | API results `[200,409]`; service tests |
| Redis interruption and recovery | Stop/restart isolated Redis, read/API and application recovery probe | PASS for G12 | Dictionary API remained available; expected dependency recovery logs only |
| PostgreSQL interruption and recovery | Stop/restart isolated DB; in-flight and fresh probes | EXTERNAL RISK | In-flight probe exceeded 90 seconds; fresh probe recovered to `200` with 5,002 terms |
| Secret/canary leakage | API, DB, Redis, queue, logs, browser artifacts, sanitizer, secret scanner | PASS | Zero credential findings; zero canary matches in logs/artifacts; intended dictionary definitions only in DB |
| Accessibility | Keyboard/focus, dialog names, axe in editor/labels, mobile inspection | PASS WITH EXTERNAL NOTE | Zero editor/tag violations; two unrelated Page Details badge contrast findings |

## Findings

| ID | Severity | Component | Reproducibility, expected, and actual | Root cause | Status / fix |
| --- | --- | --- | --- | --- | --- |
| G12-01 | High | Dictionary editor/database highlighting | Reproducible with a dictionary alias inside an inline link, inline code, fenced code, or database rich text. Expected no dictionary decoration; actual highlights appeared in excluded semantic regions. | The incremental ProseMirror scanner and database renderer did not consistently reject link/code marks and nodes. | Fixed in `686f578b10424b8c730325cc540a7a29000a63b2`; regression tests and two-browser validation pass. |
| G12-02 | Medium | Dictionary and tag tooltips | Reproducible by keyboard navigation. Expected a named, focusable tooltip/dialog and equivalent tag affordance; actual portal content lacked complete semantics/focus behavior. | Pointer-first handlers and missing dialog/accessibility attributes. | Fixed in `95b9c42d592746519ee782d0e7b9ba7f0fa1f07a`; unit, axe, and browser keyboard checks pass. |
| G12-03 | High | Label page search / ACL | Reproducible when unreadable pages occupied the first result window. Expected pagination over readable pages; actual code paginated first and filtered later, producing short/empty pages and leaking result cardinality behavior. | Page ACL filtering occurred after repository pagination. | Fixed in `a39bc420a7e619ee9fc2e4cf6bdf1f1c8fcd7c04`; readable-page IDs are applied before pagination. Unit/API role checks pass. |
| G12-04 | Medium | Docmost archive import | Reproducible with mixed-case/compatibility labels and aliases in an archive. Expected the same canonical form and deduplication as live CRUD; actual restored rows could diverge or collide. | Archive restoration used a separate, incomplete normalization path. | Fixed in `0cde186eadcbeffc0226ffedea6f68ad4c8b9270`; archive regression tests cover labels, aliases, and deduplication. |
| G12-05 | Medium | Editor dictionary tooltip | Reproducible on real editor decorations. Expected click/keyboard activation to reach the delegated tooltip layer; actual editor handlers consumed/bypassed bubbling events. | Tooltip delegation listened in the bubbling phase while ProseMirror intercepted the event. | Fixed in `847a4002c39e4276ababb579478e3cd802173b13`; capture-phase regression and browser tooltip checks pass. |
| G12-06 | Medium | Term modal, inline tag, assigned label controls | Reproducible with keyboard/focus and compact controls. Expected stable accessible names and usable hit/focus targets; actual icon/semantic styling was incomplete. | Missing explicit labels and compact presentation rules. | Fixed in `4e9238a8a2bfbcd811d1d717969756d71fde9beb`; unit/browser/axe checks pass. |
| G12-07 | Medium | Space label registry | Reproducible from space settings. Expected admins to list, rename, and delete space labels while assignments update/cascade; actual product had assignment/search routes but no registry lifecycle surface. | Registry API and UI were absent even though labels were a space-scoped entity. | Fixed in `388a82b6fbc4fa889a9f94d7e894c96c85a5667d`: Manage Settings authorization, registry/rename/delete API, responsive UI, 12 locales, route inventory, unit/API/browser checks. |
| G12-08 | Medium | Label registry edit focus | Reproducible by entering rename mode and pressing Escape. Expected only edit cancellation and focus return to Rename; actual the parent settings modal also closed. | Mantine's window capture listener required `data-mantine-stop-propagation`; React bubbling cancellation alone was too late. | Fixed in `3c68c855786a09721dcebd2c95c5d488d4f91315`; DOM regression and real browser focus assertion pass. |
| DEP-01 | Medium | Platform database failure handling | Reproducible by stopping isolated PostgreSQL during an authenticated dictionary request. Expected bounded failure or recovery; actual the in-flight request did not finish within 90 seconds, although a fresh request succeeded immediately after recovery. | General database/network retry and request-cancellation behavior, outside G12. | Not fixed; dependency owner: platform/reliability. No canary or response data leaked. |
| ENV-01 | Low | Editor E2E / Draw.io deployment | Reproducible in Chromium and Firefox. Expected Draw.io iframe; actual `new URL()` receives an invalid empty value and `iframe.diagrams-iframe` never appears. | The documented isolated Compose environment does not pass `DRAWIO_URL`. | Not a G12 defect; deployment/editor-suite dependency. Targeted G12 Playwright remains green. |
| UX-EXT-01 | Low | Page Details badges | Axe reported contrast ratio `3.01` on two unrelated gray metadata badges. The assigned-label control itself had no violation. | Existing Page Details color choice outside the label ownership surface. | Not fixed; dependency owner: general accessibility/UI. |

## Reproduction and security evidence

### G12-01, G12-02, and G12-05

1. As space admin, enable the dictionary and create aliases that also appear in prose, links, inline code, and code blocks.
2. Open an editor page and a database text cell, type and paste matching text, then use undo/redo and a second browser context.
3. Before the fixes, excluded regions received decorations and/or editor activation did not open the tooltip reliably.
4. On image `docmost-g12:3c68c855`, only eligible prose is decorated; Enter/click opens a named tooltip, Escape closes it, and focus returns without stale decorations.

### G12-03

1. Create readable and denied pages with the same label for a restricted role, ordering denied pages into the first database page.
2. Call label page search with a small limit.
3. Before the fix, repository pagination occurred before `PageAccessService` filtering; the visible page could be short or empty.
4. After the fix, the readable-page snapshot constrains the repository query before pagination. Reader/writer direct URL and API bypass checks return only authorized pages.

### G12-04

1. Import an archive containing compatibility-equivalent dictionary aliases and labels with mixed case/whitespace.
2. Before the fix, archived rows could bypass live normalization and produce divergent names or conflicts.
3. After the fix, labels and aliases use the same canonical normalization as live paths and deduplicate deterministically. The import service regression suite passes.

### G12-07 and G12-08

1. As space admin, open Space settings, list labels, rename one to a normalized Unicode-compatible value, and delete another assigned to a page.
2. As writer/reader and by direct API, attempt registry list/rename/delete; use another space's label ID.
3. Verify admin success, role `403`, cross-space `404`, duplicate `409`, concurrent rename `[200,409]`, updated page assignments, and delete cascade.
4. Enter edit mode and press Escape. Before `3c68c855`, the settings modal closed. After it, only the edit row closes and focus returns to `button[aria-label="Rename ..."]`.

### Canary and data impact

- Only synthetic canary values were used. No production credential, private document, or external linguistic service was involved.
- Browser sanitizer results: G12 final targeted `14` text files, `0` credential findings; full editor artifacts `330` text files, `6` trace archives, `14,378` replacements, `0` credential findings; external rerun `12` text files, `8` trace archives, `10,999` replacements, `0` credential findings.
- Secret scans for all three roots report `clean: true` and no findings.
- Canary scan: browser artifacts `0`, application logs `0`, Redis keys `0`, queue payloads `0`, page content `0`, labels `0`. The database contained only the intentionally authenticated synthetic dictionary definitions used by the tests.

## Commands and exit codes

| Command | Exit | Notes |
| --- | ---: | --- |
| `git status --short`; `git rev-parse HEAD`; `git describe --tags --always` | 0 | Captured before work. Main was dirty only in five pre-existing `graphify-out/*` files. |
| `git worktree add -b codex/g12-dictionary-labels ../docmost-qa-G12 main` | 0 | Isolated worktree created from `b13bee7d`. |
| `git log --reverse v1.0.0^..e955a0c8 -- <paths>` and `git log e955a0c8..HEAD -- <paths>` | 0 | Relevant history enumerated. |
| `git show --stat --summary` and full `git show` for required/path-relevant commits | 0 | Messages, diffs, tests, migrations, contracts, and docs inspected. |
| `corepack pnpm --filter ./apps/server test -- --runInBand dictionary label` | 0 | Final: 4 suites / 24 tests. |
| `corepack pnpm --filter ./apps/client test -- src/features/dictionary src/features/label` | 0 | Argument forwarding caused full client Vitest: 138 files / 649 tests. Expected happy-dom teardown and i18n warnings only. |
| Focused `space-labels-settings.test.tsx` | 0 | 1/1 focus regression after the final fix. |
| `corepack pnpm run test:editor-ext` | 0 | 15 files / 66 tests. |
| Temporary 10,000-term matcher performance test | 0 | Index `66.99 ms`; match `160.35 ms`. Removed after use. |
| Temporary G12 Playwright spec, Chromium and Firefox | 0 | 4/4: exclusions, keyboard tooltip, tag render, two-context collaboration, undo/redo, label role checks, axe, 5,000-term update. Removed after use. |
| Dictionary API audit harness | 0 | All 53 checks passed: settings, normalization, tenant/role isolation, export/import, limits, atomicity, concurrency, labels, cleanup. Removed after use. |
| Label registry API harness | 0 | 30/30 checks passed: admin/reader/writer, cross-space, normalization, conflict, concurrent rename, cascade. Removed after use. |
| `corepack pnpm --filter ./apps/server test:security` | 0 | 66 suites / 791 tests. |
| `corepack pnpm routes:inventory:check` | 0 | 315 routes. |
| `corepack pnpm check:comments:en` | 0 | Source/docs language contract before report. Re-run after report and merge. |
| `docker compose build docmost` / isolated tagged rebuilds | 0 | Full image build after each production-code fix; final digest recorded above. |
| Redis stop/start and probes | 0 | G12 API remained available and recovered. |
| PostgreSQL stop/start and in-flight probe | interrupted after more than 90 s | Reproduced DEP-01. Fresh recovery probe returned `200` and 5,002 terms. |
| Initial full `corepack pnpm run test:editor:e2e` | interrupted | Run was stopped after the relevant G12 scenarios passed and unrelated Draw.io failures appeared; not used as full-suite evidence. |
| Targeted rerun of the two unrelated editor failures | 1 | 0/4 in Chromium/Firefox; both fail because `DRAWIO_URL` is absent. |
| `node apps/client/e2e/ai/sanitize-traces.mjs <artifact-root>` | 0 | All retained G12 artifact roots sanitized. |
| `node apps/client/e2e/ai/scan-artifacts.mjs <artifact-root>` | 0 | All retained roots clean. |
| `node ...sanitize-traces.mjs --help` and `node ...scan-artifacts.mjs --help` | 1 | Operator misuse: scripts interpret the positional argument as a directory. No product result or artifact was affected. |
| `docker exec ... select ... from migrations` | 1 | Operator used the wrong table name; corrected query against `kysely_migration` confirmed 101 migrations. |
| `graphify save-result ... --outcome useful` | 0 after interpreter guard | Initial call failed because `.graphify_python` was absent; the required interpreter guard was created, save succeeded, and all generated graph changes were removed. |

`verify:release` was not run monolithically because this G12 stack lacks the unrelated production-like AI model configuration and `DRAWIO_URL` required by the complete release matrix. Every available G12 substage, the full server security suite, route/comments contracts, production image build, targeted two-engine browser acceptance, and fault probes were executed separately. The missing full-suite dependencies are not presented as a PASS.

## Scenarios checked without a defect

- Dictionary enable/disable survives reload and hides/shows the dictionary surface without deleting terms.
- Reader can list terms for readable space content but cannot create/update/delete/import/export; writer/admin behavior follows existing space/workspace policy.
- NFKC, case, whitespace, term/form collisions, empty values, 100-form, 1,000-import, oversized-body, and partial-invalid imports converge without partial writes.
- Punctuation, hyphens, Cyrillic/Latin, mixed case, plurals/forms, overlapping aliases, and longest match retain correct original offsets.
- Small unrelated editor changes do not cause a full-document rescan; dictionary configuration/hydration correctly triggers a rebuild.
- Paste, undo/redo, remote collaboration, reload, and reconnect do not leave stale decorations in the covered Chromium/Firefox contexts.
- Label assignment/removal, database-row rendering, combined space+label+TODO search, normalized rename, delete cascade, and concurrent admin conflict behave consistently.
- Disabled built-in tags disappear from the editor command registry and can be restored; existing TODO nodes remain rendered and searchable.
- Cross-space term/label IDs, direct routes, and restricted roles do not mutate or disclose another space's registry/content.
- Redis interruption does not corrupt synchronous dictionary/label state. PostgreSQL restart restores fresh API requests without cross-space data drift.
- No unhandled G12 rejection, G12 console error, credential value, or canary appeared in the final targeted browser evidence.

## Fix report, acceptance, rollback, and observability

| Fix commit | Production change and contract/schema impact | Tests and acceptance | Rollback and observability |
| --- | --- | --- | --- |
| `686f578b` | Excludes code/link content in editor and database-cell highlighting. No API/schema/migration change. | Unit regressions plus real browser links/code pass; eligible prose still highlights. | Revert only with acceptance of false-positive semantic highlighting. Browser decoration counts expose regressions. |
| `95b9c42d` | Adds accessible tooltip/dialog semantics and tag keyboard behavior. No wire change. | Component tests, keyboard focus, axe, desktop/mobile browser pass. | Safe independent revert, but would reopen keyboard/screen-reader defects. |
| `a39bc420` | Moves readable-page filtering into label repository pagination. No public route change. | ACL-before-pagination unit and role/API tests pass. | Revert would reopen result integrity/cardinality behavior. Observe HTTP page counts and access-denied logs. |
| `0cde186e` | Reuses canonical normalization during archive label/alias restore. No migration or export contract change. | Archive import normalization/deduplication regressions pass. | Revert risks import collisions/divergence; import task failure status remains the recovery signal. |
| `847a4002` | Captures editor tooltip activation before ProseMirror consumes it. No API change. | Capture-phase unit and real click/keyboard tooltip pass. | Independent UI rollback; tooltip activation is visible in browser acceptance. |
| `4e9238a8` | Adds explicit names and accessible styling to term/tag/assigned-label controls. No wire change. | Component/browser/axe checks pass. | Independent UI rollback; axe and keyboard matrix are the guardrails. |
| `388a82b6` | Adds space-scoped registry list/rename/delete routes, DTOs, service/repo operations, settings UI, and 12 locales. No database migration; existing space-label tables/constraints are used. Route inventory rises to 315. | Focused service regressions, 30 API checks, desktop/mobile UI, normalization/conflict/cascade/role isolation pass. | Revert the commit to remove the registry contract/UI. Existing page-label assignment remains intact. Monitor `403/404/409`, page-label counts, and registry query errors. |
| `3c68c855` | Adds Mantine propagation marker and deterministic focus restoration for registry edit cancellation. No API/schema change. | DOM focus regression and real Escape/focus return pass. | Independent UI rollback; browser focus assertion catches recurrence. |

Acceptance criteria after fixes were: excluded semantic regions never decorate; eligible incremental edits remain responsive and non-stale; keyboard/pointer/touch-sized controls have names and deterministic focus return; page-label pagination contains only authorized pages; import is canonical and atomic; registry mutations are admin-only, space-bound, conflict-safe, and cascade assignments; all targeted G12 server/client/security/browser regressions pass on the final image. All criteria passed.

No migration was added, so database rollout is application-first with no schema sequencing. Rollback is commit-local except `388a82b6`, whose UI and three new routes should be reverted together. Existing data remains compatible because registry actions use the current label schema.

## Remaining risks and untested scenarios

- A physical touch device and a real screen reader were not available. Mobile viewport, pointer targets, focus order, semantic names, and axe were validated, but spoken announcements and platform gesture behavior remain unverified.
- Typesense was not configured. Database-mode search and the label/tag filter contract passed; Typesense-specific indexing belongs to the search contour and is not claimed here.
- The complete editor E2E matrix is not green in this isolated environment because `DRAWIO_URL` is absent. The two failures were reproduced separately and are unrelated to dictionary/labels/tags.
- PostgreSQL outage cancellation/backoff for an already in-flight request is not bounded by the observed 90-second window. Fresh requests recover, but the platform/reliability owner should define a timeout/retry acceptance criterion.
- The 5,000/10,000-term measurements are host-specific thresholds, not a universal performance SLA. No browser long-task observer or low-end physical mobile CPU was available.
- Existing archive migrations were reviewed and focused import behavior tested, but no destructive rollback of the historical dictionary/label creation migrations was run against cloned QA data. There is no new G12 migration to roll back.

## Evidence, cleanup, and commits

Evidence root: `D:\DevProjects\docmost-qa-G12\output\audit`.

- Final G12 browser run: `g12-final/playwright-results.json`, HTML report, screenshots, console logs, and sanitized artifacts.
- Broader editor run: `g12-final-full/playwright-results.json` and sanitized traces.
- External Draw.io reproduction: `g12-external-rerun/playwright-results.json`, screenshots, traces, and console errors.
- Product-design screenshots: `C:\Users\Pavel\.codex\visualizations\2026\08\11\019ff074-cc9a-7730-85c5-c5afd8ff39f8\screenshots\01-dictionary-desktop.png` through `10-label-registry-mobile.png`.
- Secret evidence: each retained root's `artifact-sanitization.json`, `trace-sanitization.json`, and `secret-scan.json`.

Temporary G12 Playwright specs, API harnesses, performance tests, Compose override, and database dump were not committed. The exact isolated Compose project and its volumes were destroyed after evidence collection; the shared port-3000 stack was untouched. Graphify output was restored to branch `HEAD`. Credentials and canaries were not copied to the report.

Production commits:

- `686f578b10424b8c730325cc540a7a29000a63b2`
- `95b9c42d592746519ee782d0e7b9ba7f0fa1f07a`
- `a39bc420a7e619ee9fc2e4cf6bdf1f1c8fcd7c04`
- `0cde186eadcbeffc0226ffedea6f68ad4c8b9270`
- `847a4002c39e4276ababb579478e3cd802173b13`
- `4e9238a8a2bfbcd811d1d717969756d71fde9beb`
- `388a82b6fbc4fa889a9f94d7e894c96c85a5667d`
- `3c68c855786a09721dcebd2c95c5d488d4f91315`

Test-only commits: none. Temporary audit scaffolding was removed instead. No push, pull request, tag, or release was created.

Final report commit and local-main merge head: pending integration.
