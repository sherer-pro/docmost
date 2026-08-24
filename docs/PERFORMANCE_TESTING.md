# Performance testing

This runbook separates production observation from synthetic staging load. Never
create fixtures, run virtual sessions, or enable persistent client telemetry in
production.

## Evidence boundary

A comparable result must identify both immutable application provenance and the
runtime envelope:

- application image digest (`sha256:...`);
- source revision (results with `revision=unknown` are invalid);
- Node.js, PostgreSQL, Redis, and reverse-proxy versions;
- API, collaboration, PostgreSQL, and Redis CPU/memory limits;
- replica counts and relevant deployment settings;
- test machine, browser version, network profile, and test start time.

Record this information separately for baseline and candidate images. The two
images may have different revisions, but each tested deployment must remain
immutable for the complete run, and the runtime resources must be identical.

## Production observation

Use production only to observe an affected user's real workflow. Collect three
Chrome artifacts on the affected computer:

1. cold opening of a representative heavy page;
2. a repeated in-app navigation to the same page;
3. interaction after the tab has remained open for 15 minutes.

For each case, record a Chrome Performance trace and a HAR. Before sharing:

- remove cookies, `Authorization`, CSRF headers, and all tokens;
- remove query-string values and fragments;
- replace workspace, space, page, comment, and user identifiers;
- replace page titles, text, attachment names, and search terms;
- remove screenshots or DOM snapshots that contain user content;
- verify the sanitized files by searching for the original token values, email
  addresses, page titles, and UUIDs.

Do not commit unsanitized artifacts. Synthetic harness artifacts are sanitized
automatically, but this cannot make screenshots of real user content safe.

## Server diagnostics

The API and collaboration process always sample V8 memory every 30 seconds.
Sampling is silent while pressure is normal. A privacy-safe
`runtime_heap_pressure` event is emitted:

- as `warning` after two consecutive samples at or above 85% of the V8 heap
  limit;
- as `critical` immediately at or above 95%, then at most once every five
  minutes while critical pressure persists;
- as `recovery` after two consecutive samples below 75%.

These events contain only RSS, heap used/total/limit, external memory, array
buffers, heap ratio, and process uptime. They never create heap dumps and never
contain routes, URLs, IDs, cookies, request data, or user content.

Detailed route and event-loop diagnostics remain opt-in.
`PERFORMANCE_DIAGNOSTICS_ENABLED=false` is the default in both local and
production Compose. Enable it only for a bounded observation window:

```dotenv
PERFORMANCE_DIAGNOSTICS_ENABLED=true
```

The API then adds `Server-Timing: app;dur=...` and emits one aggregate JSON log
per minute. The log contains only route templates, HTTP method, status class,
latency buckets, active-request count, event-loop p95/max, and the same bounded
memory fields.
It never uses the request URL as a route label and does not log IP addresses,
user agents, query strings, IDs, cookies, request bodies, or response content.
Disable the variable after the observation window.

## Staging prerequisites

Staging must match production for Node.js, PostgreSQL, Redis, reverse proxy,
replica count, and container resource limits. Build and deploy an immutable
image, then set the audit environment without printing secret values:

```powershell
$env:DOCMOST_PERFORMANCE_TARGET = 'staging'
$env:DOCMOST_PERFORMANCE_ALLOW_MUTATIONS = 'true'
$env:DOCMOST_BASE_URL = 'https://staging.example.test'
$env:DOCMOST_ADMIN_EMAIL = '<runtime secret>'
$env:DOCMOST_ADMIN_PASSWORD = '<runtime secret>'
$env:DOCMOST_PERFORMANCE_REVISION = '<40-character source revision>'
$env:DOCMOST_PERFORMANCE_IMAGE_DIGEST = 'sha256:<64 hex characters>'
$env:DOCMOST_PERFORMANCE_RUNTIME_METADATA_JSON = '{"api":{"cpu":"2","memory":"2GiB","replicas":1},"collab":{"cpu":"1","memory":"1GiB","replicas":1},"postgres":"18","redis":"8"}'
corepack pnpm test:performance
```

The full command creates an isolated space with synthetic p50/p95/p99 pages and
ten referenced pages. It runs two minutes of warmup and five minutes at each of
1, 10, 25, and 50 concurrent virtual sessions. Each session repeats the page
open path: sidebar, `/api/pages/info`, batch references, and comments on 20% of
transitions. The maximum accepted concurrency is 50.

For a local harness smoke test, shorten the durations explicitly:

```powershell
$env:DOCMOST_PERFORMANCE_QUICK = 'true'
corepack pnpm test:performance
```

Quick mode is a harness check, not performance evidence. To make a candidate run
fail on acceptance gates and compare TBT against a baseline:

```powershell
$env:DOCMOST_PERFORMANCE_BASELINE = 'D:\audit\baseline\browser.json'
$env:DOCMOST_PERFORMANCE_ENFORCE_GATES = 'true'
corepack pnpm test:performance
```

Fixtures are removed after the run. Set
`DOCMOST_PERFORMANCE_RETAIN_FIXTURES=true` only while investigating a failed
staging run, then remove the isolated space manually.

## Measurements and artifacts

The harness writes only under `output/audit/performance-*`:

- `metadata.json` — immutable revision, digest, timing profile, and supplied
  resource metadata;
- `browser.json` — cold and warm visibility/editability, LCP, long tasks, TBT,
  DOM, response sizes, and heap-after-GC cycles;
- `api.json` — per-route and aggregate p50/p75/p95/p99 for every load stage;
- `evaluation.json` and `summary.md` — acceptance results;
- `playwright-artifacts/p95-cold-trace.zip` and `p95-browser.har` — sanitized
  synthetic browser evidence;
- `artifact-sanitization.json` — sanitizer result, which must report zero
  remaining credential findings.

The browser assertion also records that ten unique mentions use no more than one
`/api/pages/references` request, no repeated full page-info requests, and no
comments request before the comments section approaches the viewport or a
comment is explicitly opened.

## Acceptance gates

On the p95 page:

- warm content visible p75 is at most 1.5 seconds;
- editable p75 is at most 3 seconds;
- maximum long task is at most 200 ms;
- TBT p75 is at most 500 ms and improves at least 30% from the supplied baseline;
- after 20 heavy-page navigation cycles, final heap after GC is no more than 20%
  above the median of cycles 2–5 and is not monotonically increasing.

At 50 virtual sessions, aggregate API p95 must be at most 300 ms and p99 at most
750 ms, with no timeouts or unexpected 5xx responses. If sidebar latency fails,
profile `getSidebarAccessSnapshot` before implementing the optional active-path
hydration endpoint; existing sidebar endpoints must remain compatible.

CI additionally runs the production-built Typesense projection against its
isolated Typesense service with 1,000 synthetic pages and 1,000 attachments of
16 KiB each. After two warmup cycles, eight measured reconciliation cycles run
under `node --expose-gc`. The heap slope must not exceed 1 MiB per cycle and the
final sample must remain within 32 MiB of the early measured plateau.

## Candidate verification and rollout

Run the following against the candidate source before the full staging harness:

```bash
corepack pnpm client:build
corepack pnpm check:client-bundle
corepack pnpm --filter ./apps/client test
corepack pnpm --filter ./apps/server test
corepack pnpm test:security
corepack pnpm lint
corepack pnpm verify:full
```

Deploy through a canary or controlled window without a database migration.
Observe aggregate latency, error rate, event-loop delay, and memory for 30
minutes and compare them with the production baseline. Roll back to the previous
immutable image if any latency, error-rate, or memory gate regresses. A local or
staging PASS does not prove production capacity or the user-device result.
