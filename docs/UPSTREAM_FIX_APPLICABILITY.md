# Upstream fix applicability

This checklist concerns the engineering follow-up to upstream v0.95.0-v0.97.0.
Similar upstream changes do not establish that a fork defect is reproducible.
No Enterprise implementation or dependency-stack upgrade is included.

## Confirmed defects

### Redis URL, TLS and ACL credentials

The original `parseRedisUrl` dropped TLS and ACL usernames, retained escaped
passwords, kept brackets around IPv6 hosts and produced `NaN` for an omitted
port. `artifacts/redis-url-before.json` records five failing conditions against
the compiled pre-fix helper, without recording credentials.

The shared parser now accepts only `redis://` or `rediss://`, defaults to port
6379 and database zero, decodes username/password once, unwraps IPv6 hosts, and
preserves optional `family=4` or `family=6`. DNS TLS hosts receive SNI. Certificate
chain and hostname verification keep Node's defaults. Malformed port, database,
family, fragment and credential encoding fail with messages that omit the URL.
Database and family strings must be complete valid values; previously ignored
suffixes such as `/2junk` now fail startup. Other query parameters remain ignored.

The primary Redis client, BullMQ configuration, collaboration RedisSync and
`search:reindex` pass the complete parsed options. The Socket.IO Redis adapter
already passed the full original URL to ioredis and retains that path. It still
uses the shared family validation and retry policy.

Build the server, then run `corepack pnpm test:redis-tls`. The standalone fixture
uses Redis 8 in an owned Docker container with tmpfs, Python `cryptography`, a
private key held only in memory and a public temporary CA. It verifies ACL
authentication, an escaped password, selected database, real pub/sub and a BullMQ
job, and requires `ERR_TLS_CERT_ALTNAME_INVALID` for a wrong server name. It loads
the compiled production parser, never loads `.env`, never changes system trust,
and removes the container. This is protocol acceptance with synthetic credentials,
not acceptance of an external managed Redis deployment.

### Labels during page duplication and cross-space copy

The HTTP reproduction in `artifacts/upstream-labels-before.log` creates a labelled
source and child. Before the fix, the copied root returned an empty label list.
The same reproduction passes after the fix in `upstream-labels-after.log`.

Label assignments are now inserted in the existing page-copy transaction. Copies
within one space preserve label IDs. Cross-space copies find/create names in the
target workspace/space/type namespace, reusing existing target labels and mapping
child assignments. Source assignments stay unchanged. Batches are limited to 500
records; target label rows are held against concurrent deletion while linked.

The live test verifies repeated idempotency keys, reader denial and a real
PostgreSQL trigger failure. The failure rolls back copied pages and newly created
target labels together. The explicit diagnostic command is
`node apps/client/e2e/database/run-live.mjs --upstream-repairs-only --api-only`;
the same checks also run in the full database live acceptance.

## Export and compatibility checks

### Draw.io copies across pages

The real cross-page browser test reproduced a missing copy-on-write fallback.
The attachment service rejected the foreign overwrite target, but the HTTP
wrapper replaced that expected scope failure with a generic 400. The diagram
client therefore could not allocate an independent attachment.

The wrapper now returns `409 attachment_target_conflict` with the same response
for absent targets and workspace/page/extension mismatches. It reveals no target
metadata. Diagram clients retry creation only for this explicit code or the
existing narrow legacy responses; unrelated validation, authorization and storage
errors remain errors. Page write access is checked before the upload service.
Targeted tests cover the wire contract and rejected fallback conditions. The live
HTTP and browser rerun must still verify source bytes and independent copies.

| Area | Source-backed finding | Acceptance still required |
| --- | --- | --- |
| Markdown tables | `upstream-markdown-before.json` reproduces an empty header from actual editor HTML containing semantic `th` cells after `colgroup`. A pinned patch fixes header detection and loss of repeated pipes; the dependency stays at 1.0.56. | Seven export regressions pass, including a genuinely headerless table. The Node 22 live suite verifies downloaded Markdown/HTML headers and complete pipe values. |
| Markdown `details` | Rich summary Markdown has explicit block boundaries; adjacent body blocks remain separate. Readers preserve an isolated paragraph wrapper and prioritize structured footnotes over generic superscript marks. | All 157 shared package tests pass. Compiled server round-trip, four theme/size browser cases and Node 22 downloaded files pass. |
| draw.io copy | Repeated references detach; the confirmed cross-page HTTP wrapper defect now has a uniform explicit conflict code. Other upload failures cannot trigger creation. | Rerun actual same-page/cross-page copies, original-byte checks and uniform conflict responses. |
| WebSocket | The API and dedicated collaboration process remain separate, with authenticated Redis relay and ownership leases. | Both desktop engines passed the real lifecycle/authentication-refresh test with server connection-count assertions enabled in the v41 diagnostic release attempt. Final complete release acceptance remains pending. |
| Search performance | The fork keeps its PostgreSQL/Typesense, structured-value, label and dictionary paths. | Complete the existing final performance/browser gates; no new search driver is added. |

The last column remains a work list until its concrete receipts are recorded.
React, Mantine, Hocuspocus, Node, pnpm and MCP SDK major upgrades remain separate
from these fixes.
