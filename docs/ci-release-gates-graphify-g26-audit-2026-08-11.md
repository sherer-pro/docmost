# G26 CI, release gates, audits, Graphify, and repository hygiene audit - 2026-08-11

## 1. Verdict

**PASS WITH RISKS after fixes.** The locally executable release contract is
green and no known G26 defect still permits an unsafe build to pass or causes a
deterministic local release failure. Nine logical commits fix seven
reproducible gate, artifact, documentation, and acceptance-harness defects.

The final uninterrupted `verify:release` completed with exit 0 in 1,082.998
seconds. The final editor matrix passed 23/23 without retries, AI passed 24/24,
AI Agent mode passed in an isolated Compose stack, and AI context passed. An
empty-database compiled-image smoke, restart, migration down/up, API and collab
health, and sanitized-log checks also passed.

The remaining risks are explicit:

- GitHub-hosted execution was unavailable because this host has neither `gh`
  authentication nor GitHub API credentials. Workflow semantics were checked
  statically, with immutable-pin inspection, actionlint 1.7.12, ShellCheck
  0.11.0, and the repository mutation suite. A real hosted run remains the
  source of truth for GitHub event and secret behavior.
- `audit:dead-code` and `audit:duplicates` are intentionally non-blocking. Their
  root commands exit 0 while Knip reports findings and jscpd reports 19 clones.
  These are maintenance debt, not a green code-health result.
- Graphify 0.9.33 rebuilt the TypeScript/JavaScript graph deterministically, but
  its optional SQL parser was not installed, so the explicitly retained RAG
  invariant SQL file did not contribute nodes. Source inspection remained the
  authority for that file.
- Jest reported one forced worker exit after 227/227 suites passed. It did not
  hide a failed assertion, but the open handle should be diagnosed separately.

None of these residual items blocks this local release candidate, but the first
item requires confirmation on a GitHub-hosted runner before publication.

## 2. Fixed scope, history, and implementation map

### Git boundary

- Fixed history boundary: `v1.0.0^..e955a0c8`.
- Release tag: `v1.0.0` at
  `446f6ddd68d87b28d6d1e2add90c235495149970`.
- Audit head: `e955a0c8d13be6384a08988f40b4331b9b686ce8`.
- Isolated worktree base: `226b1ba97ce771628c14f40b66007a441bf3054c`
  (`v1.0.0-319-g226b1ba9`).
- Audit branch before this report:
  `f2fe944142c7e0df348e9d74b97aafef6396bba6`
  (`v1.0.0-328-gf2fe9441`).
- The final local-main merge hash is recorded in the task handoff because a
  committed report cannot contain the hash of its own containing merge.

The required commits were reviewed with `git show --stat --summary`, full
diffs, tests, documentation, and generated artifacts: `446f6ddd`, `69e0c1c1`,
`76d04856`, `da0a2864`, `d7dd6dd7`, `e40ebbf5`, `87052469`, `51e32c32`,
`ac916c73`, `2a7e6653`, `f039e568`, `bdf2b986`, `13042a64`, `af217e7e`,
`85e643f5`, and `e955a0c8`.

Later G26-relevant work in `e955a0c8..HEAD` was also inspected and preserved:
`7fbaf9b9`, `04d9c9dc`, `a1ca3dd3`, `5cfc43fb`, `2bff82ca`, `5c9f0c3d`,
`92aefad3`, `a5e052cc`, `4e17883b`, and `00f01b73`, plus their integration
merges. Findings already fixed there were not reopened.

### Release implementation map

| Layer | Current implementation and security boundary |
| --- | --- |
| UI/browser | Playwright AI, AI Agent, editor, and AI-context acceptance drives owner, member/writer, anonymous-share, Chromium, Firefox, WebKit, desktop, and mobile surfaces. The suites inspect console errors, network behavior, accessibility, reload, offline, cancellation, and ACL changes. |
| API/contracts | `verify:release` checks the 315-route generated inventory, 15-route RAG/Postman contract, AI guide contract, MCP audit client, environment contract, CE boundary, comment language, text normalization, and audit exception ledger. CSRF origin and Host consistency is enforced during API setup. |
| Services/repos | Server unit/security tests cover controllers, ACL services, API-key/RAG/MCP guards, collaboration lease ownership, queue outbox, imports, storage, and logging. Production smoke calls the compiled API and collaboration runtime instead of source entry points. |
| PostgreSQL | The smoke starts with an empty database and applies all compiled migrations through `20260811T190000-rag-sync-target-verification`. A down/latest cycle and restart were exercised. Browser suites persist their test workspaces, users, pages, shares, AI state, and cleanup through the real API. |
| Redis/queue/collab | Official pinned Redis runs BullMQ, rate limits, RAG state, sessions, and collaboration leases. API and collab processes are independently health-checked and restarted; the RAG smoke checks durable resume and owner fencing. |
| Storage/external systems | The production image uses local mounted storage. Open WebUI compatibility uses a local protocol mock for release checks; the scheduled compatibility workflow can use the external service, but failure logs are now sanitized before persistence/upload. Draw.io acceptance intercepts the configured official iframe URL locally, so no browser test document is sent outside the host. |

Feature/config gates include `RAG_SYNC_ENABLED`,
`AI_ASSISTANT_PROFILES_ENABLED`, `AI_BUILTIN_TOOL_EXTENSIONS_ENABLED`,
`AI_EXTERNAL_MCP_ENABLED`, the independent provider/retrieval/MCP origin
allowlists, `AI_STREAM_IDLE_TIMEOUT_MS=120000`, RAG limits 120/8/2, MCP limits
60/4, `AUTH_RATE_LIMIT_STORAGE=redis`, and the production Draw.io URL. The
release tests use synthetic keys and exact canaries only.

The pipeline has no application-level cache. GitHub dependency caching uses
`setup-node` pnpm cache and a requirements-file keyed pip cache. Nx local build
cache was used by the final repeated `verify:full`. Background behavior relevant
to the gate is BullMQ/RAG synchronization and collab lease recovery. Gate
observability is GitHub job status, structured/sanitized logs, explicit health
checks, test reports, and seven-day failure artifacts.

### Files, contracts, migrations, and documentation read

- `.github/workflows/{ci,docker,rag-open-webui-compat}.yml`;
- root `package.json`, workspace package scripts, lockfile policy, Nx targets,
  `.gitignore`, `.dockerignore`, `.graphifyignore`, `knip.json`, and
  `.jscpd.json`;
- `scripts/check-release-gates*`, all `check-*` contract scripts, production and
  embedded-RAG smoke runners, non-blocking audit runner, log sanitizer/scanner,
  route generator, Graphify hash/check helpers, and browser orchestration;
- AI/editor/context Playwright configs, setup, fixtures, assertions, trace
  sanitizer, artifact scanner, and acceptance documentation;
- `ARCHITECTURE.md`, `AGENTS.md`, `README.md`, AI/RAG docs and embedded guide,
  generated route inventory, RAG Postman collection, security and outbox
  runbooks, and the dependency exception ledger;
- migrations reached by the empty-database smoke, including the current latest
  RAG target-verification migration. No schema or public contract change was
  needed by G26 fixes.

## 3. Environment and external tools

| Tool/runtime | Provenance and exact version | Purpose, isolation, and data |
| --- | --- | --- |
| Host Node/Corepack | Node `v24.16.0`; pnpm `10.4.0` | Repository-native build, lint, unit, contract, mutation, and browser runners. Secrets were loaded from `.env.qa` into process environment only. |
| Production runtime | Docker Desktop `29.5.3`; image `docmost-local:dev`, digest `sha256:0bdb72921976f5eb49f6032db84f07bb5a2b08f2f3b3740a12ed713c800ab1f8`, built from `1d45b383` | Node `v22.23.2` compiled runtime. Later changes touched workflows, tests, runners, and docs only. No image push occurred. |
| PostgreSQL | official `postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15` | Separate `docmost-g26-ci-*` database/volume for destructive empty-DB, restart, and down/up tests. Removed after success. |
| Redis | official `redis:8-alpine@sha256:978f0e01593e65eed801f2402944efcd936d43b5027e4908a7897baf88ed6241` | Separate network/volume for smoke and recovery tests. Removed after success. |
| Playwright | repository-pinned dependency and bundled Chromium/Firefox/WebKit | Real browser, multi-context, accessibility, network, offline, reload, ACL, and recovery coverage. Success traces were removed; sanitized defect artifacts remain. |
| actionlint | official release `1.7.12`, Windows x86-64 asset, SHA-256 `6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9` | Local workflow syntax/expression/ShellCheck integration. Asset digest was matched to the official GitHub release metadata; binary removed after use. |
| ShellCheck | official release `0.11.0`, Windows x86-64 asset, SHA-256 `8a4e35ab0b331c85d73567b12f2a444df187f483e5079ceffa6bda1faa2e740e` | Called by actionlint for shell fragments. Binary removed after use. |
| Graphify | installed local `0.9.33` | Supplementary code-graph navigation and deterministic update with `PYTHONHASHSEED=0`, `GRAPHIFY_MAX_WORKERS=1`. No source or test data left the host. |

No MCP server, SaaS audit tool, `act`, or new repository dependency was added.
The tool download and successful browser artifact directories were removed with
an exact-path `git clean` after a dry run. Two earlier PowerShell cleanup calls
were rejected before execution by the command policy and changed no files.

## 4. Coverage matrix

| Requirement/scenario | Static/unit/integration/browser/fault/security check | Result | Evidence |
| --- | --- | --- | --- |
| All root verification targets | Fresh isolated worktree install; quick, full, and release run with durations and exit codes | PASS after G26-01/G26-05/G26-06/G26-07 | command table below |
| Gate mutations | 57 focused source mutations remove/disable/fail-open every required command; three sanitizer contract tests; direct bypass reproducer | PASS after G26-02 | `check-release-gates.test.mjs`; `output/audit/g26/release-gate-bypass-repro.mjs` |
| Production smoke | Empty DB migrations; compiled API/collab; MCP/ACL/collab; restart; migration down/latest; exact-secret log scan | PASS | `output/audit/g26/production-smoke/` |
| Browser stability | AI twice plus final release; editor three full runs plus targeted reruns; context and Agent mode | PASS after fixes | final 24/24, Agent PASS, 23/23, context PASS |
| GitHub Actions security | permissions, event boundaries, immutable action pins, pinned service images, cache config, concurrency, retention, publish dependencies, fork secrets | PASS WITH LIMIT | actionlint/ShellCheck 0; real hosted run unavailable |
| Dependency high/exceptions | production audit plus exact exception schema, evidence, rationale, and review date | PASS | one high finding, one exact ignored exception, review `2026-10-30` |
| Generated/docs/text | 315 routes, 15 RAG routes, AI docs, comments language, CRLF/CR/LF normalization | PASS | all checkers exit 0; no generated diff |
| CE boundary | path/import/symbol/config/route mutations and exact historical migration allowlist | PASS | 9/9 mutation tests |
| Architecture/dead code/duplicates | dependency-cruiser plus direct inspection of Knip/jscpd outputs | PASS WITH RISKS | no cycles; Knip and 19 clone findings remain |
| Graphify | current branch update twice with fixed hash seed/one worker; ignore audit; SHA-256 comparison | PASS WITH LIMIT | 14,449 nodes, 42,115 edges, 633 communities; second update made no topology/output change; SQL parser absent |
| Repository ignore policy | `git check-ignore --no-index`, tracked-file inventory, Docker context review | PASS | output/data/env ignored; required source and RAG SQL not ignored; six intentional graph artifacts tracked |
| AGENTS accuracy | every listed verify/check/test command compared with current `package.json`; single image and embedded RAG topology checked | PASS after docs fix | `1d45b383` |
| Secret canaries | Synthetic exact secrets through CI log sanitizer; recursive artifact and ZIP scan | PASS after G26-04 | final `output/audit/g26/secret-scan.json`, zero findings |

The release-gate mutation set covers removal of build, lint, client/server unit,
security, CE boundary, environment, AI docs, route inventory, RAG docs, audit
exceptions, dependency audit, integration build/migrations/smoke, AI, Agent,
editor, context, RAG resume, and artifact gates. It also covers a command hidden
in a comment, a disabled step, `|| true`, root `||` chaining, floating action
references, and publish without successful smoke.

## 5. Commands, durations, and baseline failures

Read-only `git`, `rg`, workflow/source inspection, Docker inspect, API health,
and hash commands exited 0 unless noted. Material commands are listed below.
Resource peaks were not instrumented; the dependency column states the actual
runtime requirements instead of inventing CPU/RAM figures.

| Command | Exit / duration | Dependencies and result |
| --- | --- | --- |
| initial `git status --short`, `git rev-parse HEAD`, `git describe --tags --always` | 0 / <1 s | base `226b1ba9`; only five hook-generated Graphify files dirty; original main files preserved |
| `corepack pnpm install --frozen-lockfile` | 0 / 30.265 s | 2,180 packages, pnpm store/cache; no network upload |
| baseline `corepack pnpm run verify:quick` | 0 / 214.682 s | host Node/pnpm; no live DB required |
| baseline `corepack pnpm run verify:full` | 1 / 132.914 s | stopped at client unit: localization expected 31 keys, actual 32 |
| final `corepack pnpm run verify:full` | 0 / 192.520 s | full build/lint, 227 server suites/1,796 tests, 139 client files/663 tests, security 66/797 plus 6/78 |
| first `corepack pnpm run verify:release` | 1 / 201.487 s | correctly stopped at AI setup: documented `127.0.0.1` transport plus `localhost` origin returned CSRF 403 |
| final `corepack pnpm run verify:release` | 0 / 1,082.998 s | healthy production-like API/collab, owner cookie, local mocks, all unit/security/contracts/browser gates |
| routes, RAG, AI docs checks | 0 | 315 routes, 15 RAG routes, AI critical keys/root MCP/migration ledger current |
| CE/env/audit-exception/comments/text checks | 0 | CE 9/9, env 5/5, one exact audit exception, comments and line endings current |
| `node --test scripts/check-release-gates.test.mjs` | 0 / 57 tests | every required gate and fail-open mutation rejected |
| release checker aggregate | 0 / 60 tests | 57 gate mutations plus 3 CI log-sanitization tests |
| direct pre-fix bypass reproducer | 0 as harness; three empty error arrays | checker incorrectly accepted `test:security || true`, a disabled security step, and root `&&` changed to `||` |
| actionlint 1.7.12 with ShellCheck 0.11.0, pre-fix | 1 | three `SC2086` findings in Docker release image commands |
| actionlint/ShellCheck final | 0 | all three workflow files clean |
| `audit:deps` | root 0 / 3.098 s | inner dependency-cruiser 0; 2,605 modules, 5,754 dependencies, no violations |
| `audit:dead-code` | root 0 / 6.593 s | inner Knip 1; findings listed under residual risks |
| `audit:duplicates` | root 0 / 0.747 s | inner jscpd 1; 19 clones, 578 lines/2,941 tokens, 0.27% |
| `docker compose build docmost` | 0 | local production Dockerfile; final digest recorded above |
| isolated empty-DB migrate/API/collab smoke | 0 | pinned PostgreSQL/Redis; API and collab 200; Node 22.23.2 |
| app/collab restart and health recheck | 0 | both returned healthy/200 after restart |
| latest migration down then latest | 0 | compiled migration path recovered; app health returned 200 |
| AI browser full run 1 | 0 / 24 of 24 | owner/member and multiple browser profiles |
| editor full run 1 | 1 / 18 of 23 | four Draw.io failures plus Firefox reload abort; defect evidence retained |
| Draw.io targeted without runtime URL | 1 / 0 of 2 | proved workflow/runtime mismatch |
| editor full run 2 | 1 / 22 of 23 | only Firefox `NS_BINDING_ABORTED` remained |
| synced-block targeted after fix | 0 / 2 of 2 | Chromium and Firefox |
| editor full run 3 | 0 / 23 of 23, 5.1 min | no retries |
| AI setup with split transport/origin before fix | 1 twice | CSRF 403 reproduced with documented env |
| AI browser after Host fix | 0 / 24 of 24, 1.4 min | split transport/origin supported |
| AI context targeted | 0 | setup, browser assertions, and cleanup passed |
| final artifact sanitizer/scanner | 0 | 8 trace roots sanitized before cleanup; retained evidence rescanned, zero credential findings |
| Graphify update 1 / update 2 | 0 / 0 | second run reported no topology change; five output hashes identical |
| `git check-ignore --no-index` matrix | expected mixed 0/1 | output/data/env ignored; Graphify exception and required sources visible |

The baseline failures above were captured before the corresponding production
workflow or test-only fix. No unrelated failing assertion was changed.

## 6. Findings

| ID | Severity | Component | Reproducibility | Expected / actual | Root cause | Status and fix |
| --- | --- | --- | --- | --- | --- | --- |
| G26-01 | Medium | client localization gate | 100% in `verify:full` | current locale contract passes / fixed count expected 31 while every locale exposed 32 keys | neighboring guide change added one required key without updating the assertion | fixed `823af9af` |
| G26-02 | High | release-gate self-check | 100% with three source mutations | checker rejects fail-open/disabled gates / all three returned no errors | substring presence checks ignored shell control flow and step `if` semantics | fixed `ad4226d9`; regression `4c2a1b41` |
| G26-03 | Low | Docker workflow shell | 100% with actionlint/ShellCheck | safe quoted image reference / unquoted `${VERSION}` produced SC2086 three times | shell interpolation was not quoted | fixed `ebc33852` |
| G26-04 | High | failure artifact secrecy | 100% with exact synthetic canary | sanitizer failure blocks upload and raw external logs never persist / one pipeline swallowed sanitizer failure and weekly compatibility stored unsanitized external logs | `|| true` covered the full pipe; compatibility path lacked pre-write sanitation, scan, and marker | fixed `eafcb19e` |
| G26-05 | High | editor release acceptance | 100%, Chromium and Firefox | Draw.io browser shim exercises a configured runtime / CI production app had blank `DRAWIO_URL`, so four editor gates failed before iframe creation | workflow configured the route intercept but not the application runtime URL | fixed `ce802389` |
| G26-06 | Medium | Firefox editor acceptance | two consecutive full runs | ACL mutation reload completes / Firefox rejected the in-flight reload with exact `NS_BINDING_ABORTED` | harness treated Firefox's documented navigation cancellation as a product failure | fixed `44e1a4bc` |
| G26-07 | High | AI release acceptance setup | 100% twice with documented env | transport may use `127.0.0.1` while CSRF origin remains `localhost` / Node supplied the transport Host and server rejected setup with 403 | harness did not bind HTTP Host to the configured CSRF origin | fixed `f2fe9441` |

## 7. Finding evidence, impact, and reproduction

### G26-01 - stale localization cardinality

Run `verify:full` or the focused localization test. Before the fix it reports
`expected 31, received 32` at `ai-localization.test.ts:213`. The new
`adminGuide.securityOutboundConsent` key was already present in all 12 locales
and in the component. The minimal fix changes only the expected contract count;
8/8 focused tests and the full 663-test client suite pass. Impact was a false
release stop, not missing user-facing text.

### G26-02 - fail-open gate checker

In an in-memory temporary workflow/package fixture, mutate the required security
command to `pnpm test:security || true`, add `if: false` to its step, or replace a
root `&&` with `||`. Before the fix `validateReleaseGateContract` returned `[]`
for every mutation. The parser now evaluates workflow steps and run blocks,
rejects disabled required steps and suffix fail-open operators, and validates
root verify scripts as exact `&&` segments. Impact was future policy drift being
reported as protected even when a failed security/build/test command could not
block publication.

### G26-03 - unquoted release version

Run official actionlint with ShellCheck against `docker.yml`. It produced
SC2086 on the three build/tag/push references. Quoting the full image reference
removes all findings and preserves Docker semantics. The practical exploit
surface was low because the version is generated by the workflow, but release
shell should remain robust under all legal input.

### G26-04 - raw compatibility failure logs

Pass exact synthetic canary values through the log pipeline and force a
sanitizer failure. Before the fix the broad `|| true` could let the following
step proceed, and the external compatibility workflow had no scan/marker. The
new grouped pipe tolerates only `docker logs` failure; sanitation and scan must
succeed. The compatibility runner sanitizes before disk, scans exact canaries
and generic JWT/cookie/Bearer patterns, creates `.sanitized`, and upload is
conditioned on that marker. The synthetic artifact test and recursive final
scan found zero secrets. Impact was credential disclosure in seven-day CI
artifacts on a failure path.

### G26-05 - missing Draw.io runtime URL

Run editor acceptance with the workflow's local iframe route shim but without
`DRAWIO_URL`. Chromium and Firefox both fail before iframe creation; four cases
failed in the first full matrix and the focused matrix passed 0/2. Configure
`DRAWIO_URL=https://embed.diagrams.net` in the production app and
`DOCMOST_DRAWIO_AUDIT_URL` in the test step. Playwright intercepts the request
locally, so no page content reaches the external host. Focused 2/2 and final
23/23 pass. Impact was a deterministic false release blocker and untested
Draw.io copy-on-write behavior.

### G26-06 - Firefox canceled reload

In the two-role synced-block test, revoke public access and reload the anonymous
share in Firefox. Two full matrices reached the same exact
`NS_BINDING_ABORTED`. The helper catches only that exact Firefox error and
performs one explicit navigation to the same public URL; every other error is
rethrown and all post-reload 403/readonly assertions remain. Focused 2/2 and two
later full executions through editor and `verify:release` pass. Impact was a
flaky release blocker, not weakened ACL coverage.

### G26-07 - CSRF Host/origin mismatch

Set `DOCMOST_API_BASE_URL=http://127.0.0.1:3000` and
`DOCMOST_API_ORIGIN=http://localhost:3000`, then run AI setup. Before the fix the
owner and invited-member mutations return 403 twice because Node sends Host
`127.0.0.1` while Origin is `localhost`. The harness now derives and sends Host
from the trusted origin while retaining the IPv4 transport. Focused AI 24/24 and
the final release run pass. Production CSRF behavior was not relaxed.

## 8. Checked scenarios with no defect

- GitHub workflows use top-level `contents: read`; 40 third-party actions are
  pinned to full immutable commits; PostgreSQL/Redis service images are pinned
  by digest.
- CI cancels superseded pull-request runs; Docker publication does not cancel an
  active release; jobs publish only after the reusable CI gate succeeds.
- DockerHub secrets appear only in release/workflow-dispatch publication, not in
  the pull-request CI path. Failure artifacts require a sanitizer marker and use
  seven-day retention.
- Empty DB, Redis, compiled API, and compiled collab have no dependency on local
  `src`, `.env.qa`, `node_modules`, Graphify, or audit output inside the image.
- API/collab restart, migration down/latest, RAG resume, cancellation,
  idempotency, offline/reconnect, ACL revocation, private chat isolation, and
  anonymous readonly share behavior passed.
- Route generation, RAG/Postman, AI guide, CE boundary, comments, audit
  exception, and line-ending checks are deterministic on Windows. Their check
  commands did not rewrite tracked files.
- The dependency audit exception is exact, justified, evidenced, time-bounded,
  and does not broadly ignore high findings.
- No dependency cycle remains. Removed compatibility aliases and inert
  configuration are absent from current routes/source checks.
- `.gitignore` blocks local DB/storage/build/audit/env/secret paths without
  hiding application source. `.graphifyignore` blocks `output/`, `data/`,
  generated evidence, and the graph itself while explicitly retaining the
  required RAG invariant SQL source.
- Repeated Graphify update produced identical hashes:
  `.graphify_labels.json` `6bd6a0a7...a925c`, `GRAPH_REPORT.md`
  `52a26512...20f0d`, `graph.html` `8389d681...2fdef`, `graph.json`
  `67392fc7...96da4`, and `manifest.json` `6d7e4424...b3df63`.

## 9. Limitations and unverified scenarios

- No GitHub-hosted runner was available. Event payload, fork token downgrading,
  GitHub cache service behavior, environment approvals, and DockerHub login were
  therefore not executed live.
- The scheduled real Open WebUI compatibility job was not invoked. Release
  testing used the repository's local protocol mock and synthetic credentials;
  no real key was persisted or included in evidence.
- Host CPU and memory peaks were not measured. Durations, process/runtime
  dependencies, image digest, and test counts are recorded instead.
- Graphify omitted one SQL file because `tree_sitter_sql` was unavailable. The
  SQL was reviewed directly and remains protected by ignore and CI checks.
- Knip and clone findings were not refactored because they span other feature
  contours and the audit commands are explicitly informational. Owners should
  triage them as separate maintenance work.
- The Jest forced-worker warning needs a focused `--detectOpenHandles` run; no
  failed suite or non-zero result accompanied it.
- Original-main `graphify-out/*` contained user-owned uncommitted changes. The
  audit updated and compared Graphify only in the isolated worktree and did not
  commit or overwrite those generated files during main integration.

## 10. Fix report, rollout, and residual risk

| Finding | Files/modules changed | Regression and recheck | Rollout/rollback and observability |
| --- | --- | --- | --- |
| G26-01 | localization contract test only | focused 8/8; client 663; full/release green | no runtime rollout; revert one assertion if the guide contract changes again |
| G26-02 | release checker and mutation tests | 57 gate tests; 60 aggregate; bypass reproducer now rejected | CI-only; rollback both parser and tests together; checker errors name the missing/fail-open gate |
| G26-03 | Docker release workflow and checker | official actionlint/ShellCheck 0; release checker green | workflow-only; rollback quote change; actionlint provides line-level diagnostics |
| G26-04 | CI and compatibility workflows, runner, sanitizer, tests | synthetic canary, exact/pattern scan, marker mutation, final artifact scan | workflow-only; fail closed; seven-day uploads occur only after marker |
| G26-05 | CI runtime/test env, editor acceptance docs, checker/tests | baseline 0/2 and four full failures; focused 2/2; final 23/23 twice | workflow-only; iframe remains locally intercepted; job log names runtime/shim contract |
| G26-06 | synced-block Playwright helper | failure twice; focused 2/2; final editor 23/23 and release 23/23 | test-only; narrow exact-error catch is reversible; all ACL assertions remain observable |
| G26-07 | AI audit HTTP setup and checker source assertion | failure twice; focused 24/24; release 24/24 | test-only; no server CSRF change; failed setup remains a visible non-zero gate |

Acceptance criteria are met: every reproducible G26 finding has a minimal fix,
a regression, a focused rerun, and a full final release rerun. No public API,
schema, migration, tenant boundary, or production application code changed.

## 11. Evidence, commits, and cleanup

Sanitized retained evidence is under `output/audit/g26/`:

- `browser-editor-run1-final/` - Draw.io and Firefox baseline failures, traces,
  screenshots, console, Axe, network, and confirmed-defect records;
- `browser-editor-run2-final/` - post-Draw.io Firefox reload failure;
- `drawio-harness-baseline/` - focused missing-runtime reproduction;
- `verify-release/` - first monolithic AI CSRF failure;
- `browser-ai-run1*/` - initial setup evidence;
- `production-smoke/` - sanitized empty-DB/restart/migration logs;
- `release-gate-bypass-repro.mjs`, `synthetic-sanitized.log`, and the root
  `secret-scan.json`.

Successful traces and downloaded actionlint/ShellCheck binaries were removed.
The final recursive scanner reports zero exact-secret, JWT, cookie, or Bearer
findings. Isolated smoke containers, network, and volume were deleted. The
shared `docmost` and `collab` services were restored from the original `.env`;
both are healthy, the temporary mock allowlist is absent, and Draw.io returned
to the deployment default.

Logical commits before this report:

- `823af9af` - `test(ai): sync administrator guide key count`;
- `ad4226d9` - `fix(ci): reject fail-open release gate commands`;
- `4c2a1b41` - `test(ci): expand release gate mutation matrix` (test-only);
- `ebc33852` - `fix(ci): quote release image version`;
- `eafcb19e` - `fix(ci): sanitize compatibility failure artifacts`;
- `1d45b383` - `docs: align release verification guidance`;
- `ce802389` - `fix(ci): configure isolated Draw.io acceptance`;
- `44e1a4bc` - `test(editor): stabilize Firefox share reload` (test-only);
- `f2fe9441` - `test(ai): align audit transport host` (test-only).

The report commit and final local-main merge hash are recorded in the task
handoff. Nothing was pushed; no pull request, tag, release, or public artifact
was created.
