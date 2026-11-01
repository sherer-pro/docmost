# Upstream roadmap implementation checkpoint

Date: 2026-11-01. The user resumed implementation of all remaining work in
stages 1–4. Push and deployment are explicitly on hold. The complete release
gate passed on `a0f360fe`; later full WebKit runs exposed two UI races, corrected
in `bff6ec5b` and `d259a0db`. That candidate passes complete WebKit/release
acceptance and complete Chromium on identical application source. The following
Firefox run exposed a separate PWA navigation defect, now corrected and covered
by focused tests; final application acceptance must use the new correction.
Human-reviewed model quality remains pending, and Gemma 12B fails the database
accuracy target. Stages 1–4 are not yet complete. Remote CI for new
commits is on hold with push.

## Current acceptance state

`roadmap-final-webkit-d259a0db.log` completed with all 48 browser cases passing,
no skips, no failures and no retries. The fresh runtime
`2026-11-01T05-08-16-016Z` also passed all 31 PostgreSQL cases and 33 HTTP groups.
Processes, containers and temporary runtime files were removed. Both deletion
cases retained 580 rendered cells before and after confirmation; destination
readiness took 3575 and 3563 ms from confirmation, below the unchanged 5000 ms
limit. The six-second undo grace is unchanged.

`roadmap-final-chromium-3a02f23b.log` passed all 31 PostgreSQL cases, 33 HTTP
groups and 48 browser cases in runtime `2026-11-01T07-09-11-363Z`, with no
skips, failures or retries and successful cleanup. The full Firefox run in
`2026-11-01T07-19-38-348Z`, recorded by
`roadmap-final-firefox-3a02f23b.log`, passed 31 PostgreSQL cases, all 33 HTTP
groups and 44 browser cases, with four failures and successful cleanup.
Commit `3a02f23b` changes only the
quality harness and documentation after `d259a0db`; application source and
built server/shared artifacts were unchanged in those runs.

The Firefox integration-preview navigation failed with `NS_BINDING_ABORTED`
and an undefined `AiDocumentContextSync` lazy export. The isolated
`preload-navigation-before.json` probe reproduced both on the unchanged
recovery source: a cancelled dynamic import rejected just after
`beforeunload`, and the PWA stale-client handler reloaded the departing page,
aborting its intended destination. Chromium completed the same transition.
The corrected handler suppresses automatic recovery while departing, without
consuming its durable marker. Trusted interaction and `pageshow` rearm it.
The same after probe reaches the destination in both engines.

The permanent production-mode Vite regression passes all 18 cases across
Chromium, Firefox and WebKit in
`artifacts/pwa-recovery/2026-11-01T08-03-44.292Z`. Five recovery unit tests and
targeted ESLint pass. CI and `verify:release` now include the suite; 107 release
contract/log-sanitization/negative tests pass, including guards against removing
the new CI/release check. One earlier default-sandbox test could not reach its
own loopback mock; that focused test and the complete 107-case run pass with
loopback access. No assertion, retry, five-second deadline or undo grace changes.

The other Firefox failures were a record title not visible within five seconds,
destination readiness after undo at 6817 ms, and the next deletion case expecting
900 rows after the preceding failed test had never clicked Undo. Its screenshot
shows 899 rows. The direct-record screenshot shows the correct row-800 properties
and a still-pending title. The initial post-failure host sample observed ffmpeg
using 87.1% of all CPU, and the later sample at 08:07 UTC observed 74.8%.
Those later samples do not prove the cause of every earlier failure. The
operator has been asked for a new quiet window; user processes are unchanged.
Final full browser and release acceptance remain required after the PWA fix.

The PWA package is committed locally as `4d4899b5`. Its clean isolated QA
checkout contains no `.env`. The Node 22 client build succeeds, and its current
bundle budget passes with 439 JavaScript chunks, 44 CSS assets and initial
closure 203059 JS / 32632 CSS gzip bytes. The strict AI-guide diff gate passes
at v42; this package changes the general client recovery path, not AI tools,
policies or server inference. The compiled version is ready for final runtime
acceptance when resources are available. These build/static/focused results do
not substitute for that final full acceptance.

The unchanged complete `verify:release` passed with exit code zero on this same
corrected candidate in runtime `2026-11-01T05-18-11-846Z`, recorded by
`roadmap-verify-release-d259a0db.log`. Its receipt names exact revision
`d259a0dbe8c9e60764e4f2240639149d224f4bdd`, Node 22.23.4 and successful cleanup.
It includes all 2540 server tests, 943 client tests, complete security and release
contracts, 28 AI browser cases, Agent Docker acceptance, editor artifacts and
AI context audit `01a195a5-0f75-7c77-82a4-ca4b9bb33bfd`.

The editor result is 64 passed, two existing explicit skips and one flaky case
that passed its configured retry. The first Firefox complex-document attempt
showed the generic error page after Back navigation; the retained console has an
error object without an explanatory message. Its cause is not established. The
current lifecycle/connection-count case passed its first attempt. These facts
do not erase the earlier, different `a0f360fe` navigation flake described below.
No retry setting, assertion, timeout or production route was changed for either.
The two explicit Firefox skips are existing Chromium-only responsive TOC and
desktop header-order checks; their Chromium executions passed.

The corrected database holdout in `2026-11-01T05-49-04-793Z`, recorded by
`ai-database-holdout-d259a0db.log`, stopped after 58 of 80 questions. Fifty-three
tool traces matched the oracle; five access cases did not. These original
captures are retained unchanged and are not accepted as a complete holdout.
The model used `google/gemma-4-12b-qat` at `http://127.0.0.1:1234/v1` with frozen
inference settings. The next request returned the normal pending-proposal quota
error after six synthetic proposals accumulated without a decision. This is
the separate documented proposal quota, not a provider-slot leak. The harness
now cancels each synthetic proposal after capturing its unchanged answer and
tool trace, recording cancellation separately. Production admission limits,
model settings, prompts and scoring are unchanged. The subsequent complete
capture is described below.

The harness repair passes Node 22 syntax validation, all ten quality-selection
and benchmark contract tests, the AI/fork documentation contracts and the
English-comment check. It changes no application source or inference settings.

The full corrected-harness database capture completed all 80 cases in
`2026-11-01T06-50-50-870Z` on local commit `3a02f23b`, with log
`ai-database-holdout-3a02f23b.log`. The configuration comparison receipt confirms
identical model, provider, inference limits, complete question list, corpus,
hardware, concurrency, lockfile and server/shared artifact hashes. No application
source changed after `d259a0db`. All eight proposals have correct tool traces
and were cancelled without approval after capture. Seventy-one of 80 cases
match the oracle. All eight access questions and `db-19-empty_budget` fail:
the model introduces wrong or malformed extra filters, sometimes falling back
to a partial legacy row list. The immutable original interrupted capture is
retained independently. Owned processes, capture proxy and containers were
removed successfully.

The separate RAG holdout completed all 80 questions in
`2026-11-01T06-32-36-163Z`, recorded by `ai-rag-holdout-d259a0db.log`. The
capture receipt has `captureComplete=true`, `passed=null` and successful cleanup.
Its automated evidence recall and citation validity are both 1.0; forbidden
evidence and forbidden control answers are both zero, and preparation p95 is
2140 ms. `ai-rag-holdout-d259a0db-unreviewed-report.json` retains the evaluator
output. Actual human review remains pending, so `measured` and `accepted` remain
false. Model capture completed before the remaining heavy browser work began.

The first combined report incorrectly marked 100 legacy row sources as
forbidden: the observer compared row entity IDs with corpus page IDs and treated
their null document excerpts as missing row data. The captured completed tool
results retain both identities and the row payload, and the actual provider
requests retain that payload with its marker. The observation helper now checks
that binding, the complete immutable seeded cell values, ACL/AI-policy fixture
flags, and exact row-plus-marker transmission within one tool-result message.
It preserves unknown, inaccessible, stale, altered or untransmitted sources as
failed evidence. No application behavior or evaluator threshold changes.

`reproject-ai-database-evidence.mjs` validated the exact original corpus bytes,
case/model/sequence/hash references and wrote separate derived evidence with
input/output provenance. All 100 row sources are supported by actual reads and
transmission. Raw captures and the initial report remain unchanged. The
projected combined report contains all 160 cases, recall and citation validity
1.0, zero forbidden evidence/control answers and database accuracy 0.8875.
The nine database failures are unchanged. Human review is zero, so neither
faithfulness nor false abstention is accepted and `measured/accepted` remain
false. Inference was not repeated for this metadata correction.

All 18 focused observation/transmission/selection/evaluator tests pass, including
negative cases and offline replay/overwrite guards. Syntax, AI/fork documentation
contracts and the English-comment check pass. The full 160-case projected
review packet loads and navigates in headless Chromium with zero page errors
and zero human annotations; its screenshot was inspected. This UI smoke created
no review annotation or export.

### Earlier candidate findings

The subsequent `bff6ec5b` full WebKit run also passed PostgreSQL, all HTTP groups
and 47 browser cases, including both corrected deletion cases. Its one failure
was the decimal/date sequence, not another checkbox crash. There were no script
errors: after numeric Enter/save, a late navigation opened the next row's amount
editor instead of preserving the date cell's newly acquired focus. The complete
receipt is `2026-11-01T04-43-27-735Z`; owned runtime cleanup passed.

`database-enter-focus-before-webkit-target.log` reproduced this precisely by
holding the numeric save response until another cell had focus. The initial
`database-enter-focus-before-webkit.log` used an incorrect input role and did not
exercise the hypothesis. The corrected reproduction retained a focused next-row
amount editor in its screenshot. The completion handler now checks whether a
different cell acquired focus before performing its old Enter/Tab navigation.
The existing edit-session check is preserved.

`database-enter-focus-after-browser-matrix.log` passed all 18 focused scenarios
across Chromium, Firefox and WebKit: keyboard selection, a newer edit session,
the focus race, checkbox state and both deletion paths. The final Enter cases
then passed all six checks in `database-enter-focus-both-paths.log`, including
ordinary Enter navigation when focus stays in the source cell. Targeted ESLint
passes. Full corrected-candidate WebKit/release acceptance remains required;
neither failed full run is relabeled as accepted.

The full `a0f360fe` WebKit run passed 31 PostgreSQL cases, all 33 HTTP groups and
47 of 48 browser cases. The remaining case crashed while selecting a row, before
deletion or undo: its browser-error attachment records a null
`event.currentTarget.checked` in the table's deferred state updater. The failed
runtime `2026-11-01T04-19-15-408Z` cleaned up all owned resources. Its log is
`roadmap-final-webkit-a0f360fe.log`; it is not accepted as a complete browser pass.

A small synthetic browser regression dispatches native checkbox clicks in one
JavaScript turn. On the old code it reproduced the same null `currentTarget`
error (`database-checkbox-before-webkit.log` and its trace). The handler now
captures the boolean before scheduling React's updater. The regression plus
existing undo/final-deletion tests pass in Chromium, Firefox and WebKit: nine
cases in `database-checkbox-after-browser-matrix.log`. No wait, assertion, route,
event retry or six-second undo grace was weakened. Full corrected-candidate
acceptance follows this focused check.

The v42 package fixes a real legacy database-tool cursor disclosure. The
PostgreSQL reproduction in `legacy-ai-cursor-before-postgres-repro.log` returned
the internal ID of a denied row in the encoded cursor. ACL and AI exclusions
now participate in SQL before pagination; the root, returned rows and lookahead
row are revalidated before emission. The scoped v1 cursor format remains
compatible, and tool schemas and inference settings were not tuned.

The targeted server run passed 47 tests, including five access-change cases.
`legacy-ai-cursor-full-postgres.log` passed all 32 cases across database tables,
plain-text attachment indexing and the RAG evidence migration. The canonical
document, structured guide, contract v42, all 12 locales and both approved fork
overviews describe the same boundary. Static AI/fork documentation contracts and
the English-comment check pass. The strict guide diff from `8ce20d3b` to
`a0f360fe` passes, and the 21 client guide tests pass.

`roadmap-verify-release-a0f360fe.log` completed the unchanged `verify:release`
command with exit code zero on Node 22.23.4. Its runtime receipt is
`2026-11-01T03-46-37-058Z/result.json`, with source revision
`a0f360fe97bd7142c7aa6039afbe06598b63acba`. It includes 31 PostgreSQL cases,
291 server suites / 2540 tests, 195 client files / 943 tests, the complete
security and extended release contracts, all 28 AI browser cases, Agent Docker
acceptance, editor artifact verification and the AI context audit. Owned
processes, containers and temporary runtime files were removed.

The editor matrix reports 64 passed, two pre-existing explicit Firefox skips and
one flaky case that passed its configured retry. Its first Firefox lifecycle
attempt reached the final authentication-refresh navigation, then `page.goto`
returned `NS_BINDING_ABORTED`; earlier connection-count assertions had passed.
The abort initiator is not established by the retained trace. No timeout,
assertion, retry setting or production route was changed for this observation.
Downloaded Markdown, HTML, PDF and Docmost artifacts passed content verification.
The production dependency audit reports nine low and 24 moderate findings, with
no high or critical findings; no unrelated dependency changes were introduced.

The old v41 database holdout was intentionally interrupted after 24 complete
records (22 correct traces). Both failed traces used malformed filters; the
separate SQL reproduction established the cursor defect. Raw captures remain
unchanged, and the interruption reason is recorded separately. The old runtime
cleaned up its processes, provider observer, containers and temporary files.
These partial records are an obsolete baseline, not final holdout acceptance.
Final captures must use the corrected candidate; human review remains pending.

The operator has paused external ffmpeg again; the resumed-window sample measured
3% CPU. Release acceptance used this window; the complete WebKit database run is
now using a fresh isolated runtime. After stages 1-4 and
their checks, deliver the requested session-wide implementation/review list.
Push and deployment remain on hold.

## Earlier v41 acceptance

The application/test candidate was `818d0bb2`; `bb627042` added only checkpoint
documentation. Its application code was identical to `4fa57820`. The test commit
establishes the tabs fixture's initial Read mode and records endpoint-only
navigation timings without credentials or bodies.

- `roadmap-final-firefox-attempt2.log` passed readiness, the complete 48-case
  browser suite, all 30 PostgreSQL cases and all 33 HTTP/export/import groups. Both deletion
  cases retain the original five-second navigation bound and six-second undo
  period; destination readiness took 3811 and 4145 ms from confirmation.
  Rendered cell counts remained 580 before and after each optimistic deletion.
  A sample during deletion recorded 7% CPU load and no ffmpeg process.
  The owned processes, containers and temporary runtime were removed.
- `roadmap-final-chromium-attempt2.log` passed the same complete 48-case browser
  suite, readiness, 30 PostgreSQL cases and 33 HTTP/export/import groups on
  `818d0bb2`; cleanup completed.
- `roadmap-final-webkit-attempt2.log` passed readiness, all 30 PostgreSQL cases
  and the HTTP/export/import checks. During browser acceptance, CPU load reached
  a sustained 100%, with user ffmpeg measured at 26 core equivalents. The mobile
  OAuth heading missed its original five-second wait. After preserving that
  failure, only the verified owned Playwright process tree was stopped; the
  parent performed normal runtime cleanup. This interrupted run is not accepted.
  The preceding 48-case WebKit pass on `4fa57820` is not relabeled as a
  final-candidate result. The final WebKit and complete release runs require
  another period without heavy concurrent load; no user process or timeout
  was changed.
- `diagram-copy-fixed-ai-context-diagnostic.log` passed actual same-page and
  cross-page Draw.io copying in Chromium and Firefox, including independent
  attachment IDs, saved source bytes and reload. Its context phase stopped at
  a missing Python dependency, so the combined diagnostic is not a release pass.
  `diagram-upload-conflict-http.log` independently passed all HTTP groups,
  including the uniform absent/foreign-target response and reader denial.
- An isolated Python 3.14.6 environment now contains the exact project-pinned
  document libraries; fixture generation and verification passed. With that
  environment, `ai-context-venv-diagnostic.log` passed all 30 PostgreSQL cases
  and the complete `test:ai-context:e2e` command. The temporary context-only
  release-helper patch was reversed and the checkout is clean.
- The complete `verify:full` and extended release contracts passed in
  `roadmap-verify-release-v41.log`, followed by all 28 AI browser cases and
  the Agent Docker audit. That release attempt stopped at the Draw.io defects
  described below. The unchanged complete `verify:release` still must pass
  on the final candidate, including export-artifact verification.
- `roadmap-verify-release-candidate-bb627042.log` passed the current build,
  lint, all 291 backend suites / 2535 tests and all 195 frontend files / 943 tests.
  It then stopped before the dependency protocol tests could register: their
  original 15000 ms file startup limit expired under sustained concurrent load.
  This is not a complete `verify:full` or `verify:release` pass. An isolated
  repeat kept the same limit and passed all eight protocol tests in 10 seconds.
  The separate complete `roadmap-security-candidate-bb627042.log` then passed
  all eight protocol tests, three hostile-MCP cases, 86 server suites / 1044 tests
  and seven client files / 82 tests. Every resource from the failed release
  attempt was cleaned up.
- `rag-evidence-quality-postgres-final.log` passed the real PostgreSQL migration
  check in its owned schema: existing-configuration defaults, constrained
  profiles, evidence JSON and retained answer content across rollback.
- `roadmap-ai-docs-history-coupling.json` verifies all 13 consecutive version
  transitions from v28 through v41, with canonical documentation, structured
  guide, contract and all 12 locales updated in every package. The trailing
  changes contain no uncoupled production AI logic. The single-update PR gate
  correctly rejects treating the entire 13-update history as one version bump;
  its original diagnostic output is retained, and the checker was not changed.
- The current AST graph has 17723 nodes and 50565 edges. The approved shared
  AgentMemory import admitted 5000 nodes and 9783 edges within its configured
  cap. A repeated import added zero nodes and edges. The complete graph remains
  local; no model extraction or service lifecycle change was performed.
- Full database tuning captured 120 cases; the separate six-case diagnostic
  passed the two observed date failures and four controls. Full RAG tuning
  captured 120 answers; the separate eight-case diagnostic passed all six
  attachment misses and two controls after the indexing repair. Neither has
  human annotations. The database holdout capture began on that frozen candidate
  and model; its environment receipt records the concurrent load. It was later
  interrupted as recorded above. RAG holdout had not started, and neither
  holdout has quality acceptance.

The model remains `google/gemma-4-12b-qat` at
`http://127.0.0.1:1234/v1`, temperature 0, output limit 4096 tokens, configured
context window 65536 and request timeout 600000 ms. No model or user process
was restarted or reconfigured. No push or deployment was performed.

## Historical implementation and diagnosis

The following checkpoints retain earlier observations and pending states for
traceability. The current acceptance state above takes precedence.

The focused Draw.io rerun passed the saved-image identity check and reached an
actual cross-page defect: the upload HTTP wrapper converted the service's scope
rejection into a generic 400, preventing the documented client fallback. The
wrapper now maps absent and mismatched overwrite targets to the same explicit
`409 attachment_target_conflict` response. Page write denial still occurs before
processing; unrelated failures cannot authorize creation. Targeted server tests
passed 33 cases and the diagram helper passed 10 client cases. Real HTTP and
cross-page browser confirmation remain pending on the rebuilt candidate.

The complete pre-v41 RAG baseline recorded all 120 completed answers, recall
0.95, citation validity 0.953846 and preparation p95 2423 ms. It is not accepted.
The v41 eight-case tuning diagnostic covers all six missing-attachment questions
and two controls: recall and citation validity are both 1, forbidden evidence
and answers are zero, preparation p95 is 301 ms, and every resource was cleaned
up. Neither capture has human annotations. These are separate datasets, not
a replacement for the required complete fixed-settings holdout.

The added Draw.io browser scenario copies actual attachment-backed nodes within
and between pages, edits each copy, compares the original file bytes, and checks
that source and destination attachment identities survive reload. It uses the
existing local iframe fixture and editor clipboard handlers without replacing
the host clipboard. The first full run exposed an incorrect post-save selector
in the new test: Draw.io changes the image label to the saved filename. Distinct
attachment IDs were already persisted. The corrected fixture locates saved
images by those IDs; source-byte and cross-page checks are unchanged and require
a focused rerun. The owned release runtime now
enables its existing collaboration statistics endpoint and passes its exact URL
to the lifecycle suite. The next complete release run must pass its actual
duplicate-connection assertions rather than the unconfigured capability branch.

The real RAG tuning baseline exposed two related defects: local content search
did not index Markdown/plain-text attachments, and the prompt advertised a marker
for an empty attachment-hosting page that the evidence ledger correctly rejected.
UTF-8 `.md`/`.txt` files now use the existing fenced indexing worker and limits;
invalid UTF-8 and NUL-bearing binary content are terminally skipped. A migration
queues only eligible old text attachments without disturbing claims or other
terminal failures. Prompt packing drops title-only search results before marker
registration. The quality importer keeps opaque filenames and waits for actual
attachment-content search readiness. Contract v41, all 12 locales and both
approved overviews are aligned. The targeted backend run passed 47 tests, and
the final prompt/citation subset passed 21 tests with exact excerpt checks.
The guide passed 21 client tests; lint and documentation contracts passed.
The built Node 22 candidate passed all HTTP/export/import checks, including the
real text indexing worker and search ACL, in `attachment-text-postgres-http.log`.
That diagnostic explicitly used `--api-only`; it did not run the PostgreSQL
suite. The combined real PostgreSQL suite then passed all 30 tests in the v41
release runtime, including the new backfill and fenced-worker cases. Post-fix
model captures remain pending.

The v41 release attempt also passed the complete `verify:full`, all extended
contracts, all 28 AI browser cases and the Agent Docker audit. The editor suite
is still running and the new selector failure prevents this attempt from being
complete release acceptance. The current Graphify graph has 17721 nodes and
50580 edges. The explicitly approved AgentMemory import admitted 5000 nodes and
9779 edges within its limits; its repeated import added no nodes or edges.

The isolated AI browser diagnostic passed all 28 cases across Russian and English
desktop, Firefox streaming, Pixel 7, mobile WebKit and a narrow AI panel. Its
processes, containers and temporary runtime were removed. The temporary
AI-only release-helper change was reversed; this receipt is not a complete
`verify:release` result. The coupled release-contract fixture and CI profile mock
now accept the same single-tool `required` request. A real child-process HTTP
test also retains named-choice compatibility and rejects ambiguous required
tool sets. All 105 release-gate contract tests passed.

The first isolated `verify:release` attempt on `a1ce3276` passed all 27 PostgreSQL
cases and the complete `verify:full`: 291 backend suites / 2524 tests, 195 frontend
files / 942 tests, 86 backend-security suites / 1037 tests and the frontend security
suite. The extended route, RAG, fork-documentation, comment, text, editor-package,
RAG Sync, inbound-MCP and production dependency-audit checks also passed. It then
stopped before AI browser acceptance: the MockServer fixture expected the retired
named-function choice instead of the current single-tool `required` choice.
The fixture now matches the production probe. A real HTTP negative/positive check
reproduced the missing old tool call, verified the exact new call and arguments,
rejected an unrelated tool and removed its owned mock container. Production probe
validation and timeouts are unchanged. Complete release acceptance remains pending.

The new live document-block scenarios exercise two authenticated users in
desktop/light and mobile/dark. Chromium, Firefox and WebKit completed the body
checks for concurrent edits, independent active tabs, a shared rename, stale
footnote rejection, copying to another page, undo/redo, mixed text direction,
persisted API content and reopening. The initial diagnostic failed only during
cleanup because an editor cannot permanently delete pages. Cleanup now uses
the isolated space administrator; both focused Chromium cases then passed,
including all 34 HTTP/export/import checks and complete runtime cleanup.
The final full three-browser matrix must still pass on the final candidate.

The complete database tuning capture contains 120 records: 118 correct traces
and the two date-question failures described below. Preparation p95 was 209 ms.
After the v40 tool-schema clarification, a separate six-case tuning diagnostic
passed both failures and four controls, with the model and request settings
unchanged. This does not establish holdout or human-reviewed answer quality.
The complete RAG tuning capture has started; holdout remains unopened.

`ee369cf2` fixes the property-type selector inside the creation popover. Its
portaled options were treated as outside clicks, closing the parent before the
formula action could run. The corrected nested dropdown passed all three Firefox
advanced-property scenarios at desktop, 320px and 390px with unchanged timeouts.
The same diagnostic runtime passed all 34 HTTP/export/import checks and removed
its owned processes, containers and temporary runtime. PostgreSQL was explicitly
skipped in this focused diagnostic; the complete final matrix remains required.
File scenarios now restore their owned attachment baseline through an independent
API context and use separate file names for each viewport, preventing failed
cleanup from contaminating later cases.

The ongoing complete database tuning capture exposed date-question failures:
one unsupported refusal and one answer obtained without the expected server
aggregate. Tool definitions previously advertised `viewState` as an unspecified
object. They now publish the bounded filter grammar and instruct counts through
`summarizeDatabaseView.count`. Both MCP and internal Agent receive that schema;
the compiler and permissions remain authoritative. Guide contract v40 and all
12 locales describe it. The schema/service suite passed 42 tests; model quality
after this clarification is still unmeasured. Explicit tuning-only question IDs
support focused diagnostics without opening holdout or weakening its full gate.

The final acceptance work now includes a dedicated `--release` mode for the
owned database runtime. It requires Node 22, freezes shared package artifacts,
provisions synthetic authentication and invokes the unchanged complete
`verify:release` command. Docker builds exclude `artifacts/`, and the nested
Agent Compose audit uses an empty explicit environment file. These harness
changes do not establish successful release acceptance; its receipts remain
pending until the run completes.

The first complete Node 22 database/browser attempt exposed persistent fixture
state: the AI results case left the synthetic user's drawer preference enabled,
covering later mobile controls. Its Chromium worker was intentionally stopped
after the screenshots identified the overlay. The owned runtime cleaned up all
processes, containers and temporary files. Subsequent scenarios now explicitly
start with the synthetic user's drawer closed; application behavior and original
assertion timeouts are unchanged. The interrupted run is not final acceptance.

The release dependency audit independently found GHSA-mrwp-f3q8-3g9p in
`follow-redirects` 1.16.1. The root override and lockfile now select 1.16.2;
the old library fails and the SHA512-verified patched artifact passes the same
loopback credential-isolation reproducer. Installed dependencies have not been
changed underneath the active real-model capture. Frozen-install and final
release acceptance are still required. No Axios, Node, pnpm or UI stack major
upgrade is part of this repair.

An independent frozen installation in `artifacts/roadmap-release-checkout`
completed on Node 22 and passed the redirect protocol through its installed
Postmark/Axios dependency. The main checkout's installed 1.16.1 entry hash is
unchanged, preserving the active tuning capture. Its QA server and production
client with diagnostic sourcemaps also build successfully. Final release
acceptance remains pending.

The Agent preflight found that Docker's automatic address pools are exhausted.
Its runner now accepts two explicit private test subnets and passes its exact
empty env-file and Compose file list to worker-restart/SQL checks. This keeps
nested operations on the same owned network configuration. Daemon pools, user
networks and production services are not changed.

## Implemented packages

- AI view queries and full-selection aggregates, internal Agent cell proposals
  with revision checks and transactional receipts, administrative restrictions,
  and a deterministic database benchmark corpus. Real-model holdout quality has
  not been measured.
- Server-owned database result receipts and chat cards, with calculation time,
  typed totals, field formatting, scope and conditions. A private read-only
  results page reuses frozen conditions and explicit selected rows, rechecks
  current ACL/AI policy and tool capabilities, and distinguishes recorded totals
  from current row values. Schema changes require a new query; summary-only
  permission cannot read individual rows.
- Kanban, view-specific row order, personal view drafts, column layout, linked
  database embeds, complete-view CSV and URL-addressable record previews. Record
  body/title editing and restorable history now use isolated editor state in the
  side panel. Compact controls, personal toolbar pinning and collapsible long
  descriptions complete the database navigation package.
- Search author/OR-label/title filters, navigation to highlighted results,
  subpage ordering, arbitrary history comparison, comment deep links, `/time`
  and localized slash-command matching.
- Page attachment gallery, sequential image/audio/video/PDF preview and safe
  asynchronous removal of unused files. See [the attachment contract](../PAGE_ATTACHMENTS.md).
- Collaborative footnotes, definition editing with conflict protection, search,
  Markdown/HTML/PDF/Docmost export and archive import; block-level automatic/explicit
  text direction; workspace initial editing preference copied only to new users.
  See [document blocks](../EDITOR_BLOCKS.md).
- Document tabs with collaborative rename/order/duplication, hidden-content search,
  stable citation anchors, complete exports and archive import; read-only page
  presentation with keyboard controls, long-slide scrolling, pointer and native
  full screen. Presentation forces database embeds to read-only.
- Empty-page application of regular and published synchronized templates with
  idempotency, current-access and source-revision checks, attachment compensation
  and an atomic persistence receipt. Native save-queue recovery is patched in
  Hocuspocus 3.4.4. Database descriptions and record panels do not offer this action.
- System creation/modification fields, multiple participants, row-owned file
  properties and a bounded row formula language. Views, filters, sorting,
  aggregates, CSV, AI and RAG use the shared resolved values; import and
  duplication remap property/file references. File-cell history commits with
  its mutation and prevents premature attachment cleanup. Mutation contract 4
  protects advanced values from older clients. See [database values](../DATABASE_TABLES.md).
- Native DOCX page export with child-page ZIPs, editable tables, permitted database
  snapshots, raster images, links, all tabs and Word footnotes. Source pages are
  revalidated in a batch before bytes are returned. See [DOCX export](../DOCX_EXPORT.md)
  for supported image formats and resource limits.
- Bounded local retrieval over the original question, supplied rewrites and
  literal quoted names, including searchable attachments. Canonical local
  documents that fit the existing 1200-byte parent budget retain all sections.
  Conservative RU/EN dialogue fallback preserves a single previously quoted
  name without extending the two-second model rewrite deadline. Database tools
  accept typed calculation arrays instead of requiring dynamic property-ID keys.
- Opt-in inbound MCP user OAuth with PKCE, dynamic client registration, one-space
  consent, hashed session-bound tokens, refresh rotation and replay revocation.
  Users can list and revoke their own applications. API keys remain supported;
  both MCP directions are read-only. Full release acceptance remains pending.
- Disabled-by-default GitHub/GitLab/Figma link previews with personal encrypted
  connections and link/mention/card insertion. Shared nodes, search, exports and
  AI/RAG retain only URLs. Private metadata revalidates provider authorization;
  current page access and connection revision are checked before returning it.
  Public documents never enrich links. See [integration previews](../INTEGRATION_PREVIEWS.md).
- Correct Redis URL/TLS/ACL propagation and transactional page-label copying,
  including target-space name mapping and rollback on relation insertion failure.
- Markdown export preserves table headers after column metadata and repeated
  pipe characters. Expandable summaries retain formatting and footnotes through
  rendering/import; shared readers preserve summary text and distinguish
  structured footnotes from generic superscripts.

The implementation commits include `33a86bf2`, `26d7cf6b`, `1c8bb87c`,
`f4b250be`, `85a71162` and `1af396a3` (record/template editing) on local `main`.
The advanced-property package has its recorded local acceptance. These packages have not been pushed or
deployed as part of this task.

`ae6bc660` and `d77f0909` commit the advanced-property implementation and its
SQL compiler tests locally. The AI query result package adds server-owned query
receipts, result cards and a private read-only results page. Full verification
and final HTTP/browser checks passed, including the last schema guard and
column-order adjustment. The final complete roadmap and release gates remain
pending as listed below.

## Remaining required work

- Resolve the selected model's nine database failures and obtain actual human
  evidence/refusal annotations. Both full 80-case captures and the combined
  automated score are complete; human-reviewed quality is not accepted.
  The operator has been asked whether to load the available Gemma 26B, provide
  another endpoint/model, or retain the measured Gemma 12B limitations.
- Repeat final full browser/release acceptance on
  its source in a quiet resource window. Earlier Chromium, WebKit and release
  passes retain their actual candidate boundaries; they are not relabeled as
  verification of the new PWA correction.
- Reconcile final receipts and prepare the requested session change list. The
  applicability work is recorded in [the upstream checklist](../UPSTREAM_FIX_APPLICABILITY.md);
  retain its actual evidence boundaries and keep stack upgrades separate.

Push, remote CI for the new commits, image publication and deployment are a
separate operational follow-up explicitly on hold. The current authorization is
local implementation, verification and commits on `main`.

Stage 5 items (personal/public spaces, SIEM, calendar, rollups and new retrieval
drivers) remain outside the required scope of stages 1–4.

## Deployment finding

SSH access was verified with the operator-provided encrypted key. Read-only
inspection found a pre-existing Typesense restart loop: its capability-restricted
UID 0 process cannot read the shared key file owned by UID 1000 with mode `0600`.
The verified ownership and permission requirements are recorded in
[Search operations](../SEARCH.md#deploy-typesense-beside-docmost).
No production configuration, permission or container was changed. Address this
in the final deployment procedure and verify read access from both images.

## Local acceptance evidence

- `markdown-export-final-verify-full.log`: the final Markdown package passed the
  complete gate (291 server suites / 2522 tests, 195 client files / 942 tests,
  86 server-security suites / 1037 tests and 82 client-security tests).
- `markdown-export-complete-reader-tests.log`: 35 editor-extension files / 157
  tests passed, including seven export cases, summary import with preserved
  surrounding text and footnote/superscript priority. The initial exporter run
  retains five failing cases in `markdown-export-before-tests.log`.
- `markdown-export-final-editor-browser.log`: all four desktop/mobile and
  light/dark cases passed, including Markdown import with summary footnote,
  semantic header and repeated pipes. Both import screenshots were inspected.
  `markdown-server-reader-final.json` records the real compiled server
  JSON/HTML/Markdown/JSON round-trip.
- `markdown-export-node22-live.log`: the same build passed all 27 PostgreSQL
  cases, 35 live checks, complete HTTP/export/import and both Chromium integration
  cases on Node 22.23.4. Processes, containers and runtime were removed. The
  separate portable Node binary has its official SHA256 receipt under
  `artifacts/runtime-node22`; the system Node installation was not changed.

- `upstream-repairs-verify-full.log`: full verification passed with 291 server
  suites / 2522 tests, 195 frontend files / 942 tests, 86 server-security suites /
  1037 tests and 82 frontend-security tests. The Redis and label-copy targeted
  suites separately passed 28 tests. Both fork overviews and comment-language
  contracts passed.
- `upstream-repairs-final-live.log`: all 27 PostgreSQL tests, complete
  HTTP/export/import checks, the three new label-copy/rollback groups and both
  Chromium integration cases passed. `upstream-labels-before.log` retains the
  failing pre-fix reproduction. `upstream-redis-tls-final.log` verifies the
  compiled parser with real ACL/TLS, pub/sub, BullMQ and hostname rejection; its
  result records successful owned-container cleanup and no persisted private key.
- `integration-previews-graph-import.log`: the post-commit graph contains 17665
  nodes and 50637 edges. The approved AgentMemory import admitted 5000 nodes and
  10784 edges under the shared cap; a repeated import added zero nodes/edges.
  The complete graph remains local; the imported cache is intentionally bounded.

- `integration-previews-server-tests.log`: 19 tests passed, including real
  loopback HTTP redirect/header/decompression boundaries and authorization/cache
  races. `integration-previews-editor-tests.log`: 34 files / 147 tests passed.
- `integration-previews-final-browser.log`: six Chromium/Firefox/WebKit cases
  passed in desktop/light and mobile/dark configurations, including private
  metadata isolation, URL search, undo/redo, public documents and token controls.
- `integration-previews-exports-live.log`: PostgreSQL, Redis and API checks passed
  for settings, encrypted personal credentials, ACL, revocation, node persistence
  and downloaded Markdown/HTML/PDF/DOCX/Docmost URL-only content. Provider metadata
  in this harness is explicitly synthetic. `integration-previews-public-github.json`
  separately records a successful real unauthenticated GitHub API read with the
  ordinary pinned transport and TLS validation. Real private provider tokens were
  not used.
- `integration-previews-verify-full-complete.log`: the complete contract/build,
  bundle, maintenance, lint, server and security pipeline passed (290 server
  suites / 2507 tests; 85 server-security suites / 1022 tests). A test inventory
  comparison then restored three existing Zod compatibility cases alongside the
  new CSP case. `integration-previews-preserved-client-tests.log` verifies all
  195 current files / 942 tests; `integration-previews-preserved-client-security.log`
  verifies 82 security tests. No existing Zod case or assertion is removed.
- `integration-previews-final-production-matrix.log`: all 12 production-browser
  cases passed across Chromium, Firefox and WebKit, including editor/reader
  credential isolation, reload, disconnect and existing MCP consent/connections.
  Each fresh runtime passed all 27 PostgreSQL tests and complete HTTP/export/import
  acceptance. Both Chromium integration screenshots were visually inspected.
  Earlier failures exposed a node-view page-ID initialization race and a Zod eval
  probe blocked by CSP. The reader now reuses `useEditorPageId`; form validation
  uses Zod's `jitless` mode. The dedicated regressions pass, and CSP is unchanged.

- `mcp-oauth-verify-full-accepted.log`: full verification passed with 288 server
  suites (2488 tests), 194 frontend files (940 tests), 83 server-security suites
  (1003 tests) and 78 frontend-security tests. The first full run found a diagram
  label outside the explicit AI locale namespace. Moving that label into the
  guide manifest passed all 12 targeted localization/guide tests and the repeated
  full gate; no assertion or security rule was relaxed.
- `mcp-oauth-official-sdk-focused.log`: all six isolated HTTP acceptance groups
  passed, including the installed official SDK's discovery, dynamic registration,
  PKCE and actual authenticated MCP read. Tests also cover wrong verifier,
  one-use code/refresh replay, concurrent form-encoded exchange, page ACL,
  capability revocation, other-user disconnect denial, token/session expiry,
  membership loss and disable/re-enable revocation. Original API keys still work.
- `mcp-oauth-final-browser-matrix.log`: all nine browser cases passed across
  Chromium, Firefox and WebKit: light/desktop and dark/mobile consent plus one
  existing AI cell approval per engine. Each fresh runtime also passed all 27
  PostgreSQL cases and full HTTP/export/import acceptance. The earlier matrix
  exposed test setup ordering and a WebKit callback-stub restriction; policy
  assertions and time budgets were retained. Four Chromium consent/connections
  screenshots were inspected with no clipping or overlap.
- `ai-typed-calculations-calibration.log`: all ten database tuning traces were
  correct after introducing calculation arrays, including both natural-language
  selection overrides and an unapproved write proposal. Full tuning, holdout and
  human answer review remain outstanding.
- `ai-local-query-final-verify-full.log`: complete verification passed with
  285 server suites (2464 tests), 194 frontend files (940 tests), 79 server
  security suites (975 tests) and 78 frontend security tests. The existing lint
  warnings remain; no rule, assertion budget or maintenance baseline was weakened.
- `ai-local-query-final-calibration.log`: all ten RAG tuning questions completed
  with three evidence sources each, including a cross-section question and
  dialogue continuation. Preparation ranged from 179 to 2292 ms. This diagnostic
  does not establish full-corpus or human-reviewed acceptance. The original
  capture incorrectly treated the reference envelope as undecoded text;
  `quality-transmission-recheck.json` independently decodes the immutable actual
  requests and confirms all 30 source excerpts were transmitted. Original
  records remain intact. Future runs use the corrected envelope decoder.
- `docx-verify-full-accepted.log`: full verification passed on the DOCX package:
  284 server suites (2455 tests), 194 client files (940 tests), 79 server-security
  suites (975 tests) and 78 client-security tests. Lint retained 42 warnings and
  no errors. The first run stopped on a control-character-regex lint violation;
  explicit XML code-point filtering and a supplementary-Unicode regression fixed
  it without disabling that rule.
- `docx-final-live-matrix.log`: all six DOCX download cases passed in Chromium,
  Firefox and WebKit, each at desktop/light and mobile/dark sizes. Every engine
  also passed 27 PostgreSQL cases and the complete HTTP/export/import contracts.
  Actual DOCX downloads retain inactive tabs, both native footnotes, permitted
  database rows and an owned PNG; denied rows and a revoked source do not leak.
- `docx-export/visual-receipt.json`: native Word 16.0 opened the synthetic DOCX
  with two pages, one table, one image and one footnote. Both PDF pages were
  inspected with no clipping or overlap. All nine uncompressed OOXML parts in
  the final fixture match those visually checked by Word, including after the
  XML-filter correction.
- Local `5c583f02` adds actual provider/retrieval observation and corpus v5:
  200 RAG questions plus 200 database cases, split 240 tuning / 160 holdout.
  Ten capture/scoring tests passed. The database tuning diagnostic completed
  nine of ten correct traces; one model supplied quoted property IDs and received
  validation errors. The RAG reproduction confirms all 20 guides are indexed:
  a product-name query returns its readable pages, while the full question
  returns no local candidates. No holdout or human-reviewed quality acceptance
  is claimed.

Local, ignored receipts are under `artifacts/`:

- `attachments-verify-complete.log`: build, contracts, lint and unit checks; security was interrupted by the pause and subsequently completed in `attachments-security-resumed.log`.
- `attachments-media-final.log` and `image-preview/results.json`: 26 image, media and PDF browser scenarios, with screenshots.
- `attachments-live-complete.log`: the earlier run passed the four gallery cases but failed while a second browser loaded assets from a concurrently rebuilt client directory.
- `attachments-isolated-acceptance.log`: the immutable runtime snapshot passed all five gallery/reader cases, PostgreSQL and HTTP checks, including physical storage cleanup.
- `attachments-isolated-full.log`: all 28 browser cases passed with 20 PostgreSQL tests and the complete HTTP/export/import checks; cleanup completed successfully.
- `attachments-doc-contracts-final.log`: bilingual fork documentation, comment language and text normalization checks.
- `attachments-graph-update.log`: successful local Graphify update.
- `attachments-graph-import.log`: AgentMemory import could not run because the shared service at `http://127.0.0.1:3111` is stopped. Its configuration was not changed and the service was not started.
- `footnote-live-final.log`: all three browser cases passed (Chromium, Firefox,
  WebKit), together with 20 PostgreSQL cases and the HTTP/export/import checks.
- `footnote-direction-browser.log`: editing, undo/redo, search, null-editor
  lifecycle and mixed-language block direction passed in both themes and sizes.
- `footnote-direction-editor-tests.log`: 117 shared editor tests passed.
- `initial-editor-server-tests.log` and `initial-editor-client-tests.log`: 27
  server and 9 client preference tests passed.
- `footnote-preference-direction-build.log`: complete monorepo build passed.
- `footnote-package-lint.log`: lint passed with the existing frontend warnings.
- `document-blocks-final-live.log`: six footnote/tab/presentation cases passed
  across Chromium, Firefox and WebKit, with PostgreSQL, HTTP, downloaded artifacts,
  archive import and nested-tab rejection checks.
- `tabs-search-subscription-fixed.log` and `editor-blocks/results.json`: both themes
  and desktop/mobile sizes passed, including native full screen and search that
  already exists when a tab renderer mounts.
- `search-editor-replacement-reproduction.log` and
  `search-editor-replacement-fixed.log`: a reproduced loss of the URL search term
  during editor replacement now has a regression test.
- `document-workflows-maintenance.log`: the reviewed maintenance baseline passed.
- `record-template-final-browser-matrix.log`: all six record title/body editing
  scenarios passed in Chromium, Firefox and WebKit, including mobile dark mode,
  reader access and preservation of the background table state. The original
  assertion timeouts are unchanged.
- `record-template-verify-full-accepted.log`: `verify:full` passed, including
  281 backend suites (2418 tests), 191 frontend files (928 tests), 79 backend
  security suites (972 tests) and 78 frontend security tests. Lint retained its
  existing 41 warnings and reported no errors.
- `record-template-final-editor-ext.log`: all 127 shared editor tests passed.
- `record-template-overview-contracts.log`: the approved English/Russian
  enhancement overviews passed their source-backed parity contract.
- `database-advanced-verify-full.log`: contracts, maintenance, build, lint,
  282 backend suites (2429 tests), 193 frontend files (937 tests), 79 backend
  security suites (972 tests) and 78 frontend security tests passed. Lint retained
  41 warnings; Jest also reported a worker teardown warning despite successful tests.
- `database-advanced-final-verify-full-accepted.log`: the repeated complete gate
  passed after the editor-session and deletion-virtualization fixes, with the
  same 2429 backend, 937 frontend, 972 backend-security and 78 frontend-security
  tests. Lint reported 41 warnings and no errors. The teardown warning did not
  recur with `JEST_MAX_WORKERS=2`. This does not replace browser acceptance.
- `database-advanced-atomic-postgres.log`: 27 PostgreSQL cases passed, including
  rollback of both a file mutation and its history receipt after a history failure.
- `database-advanced-subtree-http.log`: live values, full CSV, synchronous history
  retention, portable archives, queued import and attachment duplication passed.
- `database-advanced-final-native-actions.log`: nine desktop/light and 320/390 px
  mobile/dark cases passed across Chromium, Firefox and WebKit, including real
  file downloads by a reader. The mobile title-width conflict was reproduced
  with a pointer hit test and corrected without increasing assertion timeouts.
- `database-advanced-isolated-full-matrix.log`: the preceding full matrix exposed
  native clipboard fixture differences, Service Worker interception, a stale
  blur closing a newer editor and virtualization disappearing after an
  optimistic deletion. Each browser now has a fresh PostgreSQL/Redis/application
  fixture; fault injection alone blocks Service Workers.
- `database-advanced-virtualization-browser-fixed.log`: both undo and navigation
  after deletion passed in all three engines (six cases). The reproduced
  100-to-99-row transition previously increased rendered cells from 580 to 1980;
  the corrected path preserves 580 cells without changing the six-second undo
  grace or the five-second navigation assertion.
- `database-advanced-edit-session-webkit.log` and
  `database-advanced-webkit-fault-routing-fixed.log`: date reopening, delayed
  saves and all three fault-injection cases passed with the original assertions.
- `database-advanced-final-accepted-full-matrix.log`: the complete matrix was
  not accepted. Chromium passed 38 cases; Firefox had seven failures while
  competing with heavy user workloads. WebKit passed 37 of 38 cases; its scroll
  check selected a virtual overscan cell above the viewport. No user processes
  were stopped and no assertion timeout was increased.
- `database-advanced-firefox-unloaded-diagnostics.log`: all seven previously
  failing Firefox cases passed in the operator-confirmed acceptance window.
  `database-advanced-firefox-final-native-matrix.log` then passed 36 of 38 cases;
  the two deletion/navigation cases still exceeded their original total
  five-second budget (5.234 and 5.091 seconds). This remains unresolved.
- `database-advanced-webkit-scroll-diagnostics.log`: the selected overscan cell
  was measured at y=3 while its scroll viewport started at y=328. The fixture
  now selects an actually visible cell and additionally checks that beginning
  editing preserves scroll. Footnote creation explicitly positions the native
  caret at the document end rather than assuming a browser-specific End key.
- `ai-database-result-live-matrix.log`: all 12 focused cases passed across the
  three engines, including desktop/light and mobile/dark result cards, private
  link reloads, denial for another reader, footnotes and the corrected visible
  edit target. Every fresh runtime also passed 27 PostgreSQL cases and the full
  HTTP/export/import checks. New HTTP checks cover totals over 200 rows, exact
  explicit row selection, schema conflicts, query-parameter injection and ACL
  revocation before either result endpoint returns a stored value. Both
  Chromium result-page screenshots were inspected.
- `ai-database-result-server-tests-accepted.log` and
  `ai-database-result-client-tests-accepted.log`: 39 server and six client tests
  passed before the final schema-order guard adjustment. Complete current
  verification passed in `ai-database-result-verify-full.log`: 283 server suites
  (2447 tests), 194 frontend files (940 tests), 79 server-security suites (972
  tests) and 78 frontend-security tests. Lint reported 42 warnings and no errors.
- `ai-database-result-final-live.log`: the final build passed all 27 PostgreSQL
  cases, full HTTP/export/import contracts and both Chromium result-page cases,
  including the explicit visible-column order assertion. These focused checks
  do not replace the still-pending final complete database/release matrix.
- `ai-database-result-graph.log`: the local AST graph now has 17319 nodes,
  50173 edges and 730 communities. Unsupported JSON inputs and the absent optional
  SQL parser retain their existing warnings; no model extraction was invoked.
- `database-advanced-final-graph.log` and
  `database-advanced-final-graph-import.log`: AST graph updated to 17269 nodes and
  49993 edges. The operator-approved AgentMemory import passed its repeated
  idempotency check. Shared import limits admit 5000 nodes and 13191 edges;
  the complete graph remains in the local Graphify artifact.

## Model benchmark connection

The configured production model is `gemma4:31b`. Its current HTTPS endpoint fails
the normal pinned TLS request with `ERR_TLS_CERT_ALTNAME_INVALID`; no certificate
checks or production settings were changed. The operator selected local LM Studio
at `http://127.0.0.1:56254` for benchmark work. Its loaded model is
`google/gemma-4-12b-qat`, with a loaded context of 90624 tokens. Model-list and
runtime connectivity checks are separate from the still-pending corpus run and
human evidence review required by `tests/rag-quality/README.md`.

LM Studio rejects a named-function `tool_choice` object with HTTP 400. The
capability probe now offers one tool with the supported `required` choice and
retains exact name, argument and single-call validation. The new isolated
database quality runner records actual durable Agent tool steps. Its second
six-case calibration produced six correct tool traces; human answer review is
pending. The extended version 3 corpus contains 160 database cases (96 tuning,
64 holdout), including actual null cells and prompt injection. The complete
tuning capture is incomplete: 87 of 96 cases were recorded, including five
`provider_unavailable` outcomes. Human review and holdout remain pending. The
operator subsequently selected `http://127.0.0.1:1234`; its model list confirms
the same 12B model is loaded. `ai-database-lm-studio-1234-calibration.log` records
two successful real-model traces (totals and pagination, approximately 6.4 and
15.8 seconds). No model or user workload was restarted or reconfigured. This
calibration is not corpus or human-reviewed quality acceptance.

These receipts establish only the checks actually completed for this checkpoint;
they do not substitute for the remaining roadmap features or final release gate.
