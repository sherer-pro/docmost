# Picomatch production dependency correction - 17-18 November 2026

## Accepted production result

Production was accepted on 18 November 2026 (MSK). Final checks completed at
`2026-11-17T23:57:07.709724+00:00` (02:57 MSK).

| Item | Verified result |
| --- | --- |
| Application version | `1.3.5` |
| Release source / immutable tag | `d07ac14bf7f93bdc36bbac5d41762154dadf5eb3` / `v1.3.5` |
| API and collaboration image | `shererpro/docmost@sha256:2cabe0c815dfbf81600f1c0e08c8322d9e1b523a1202defa4fc8b51938ae01fc` |
| Actual local image ID | `sha256:11410c6b75251f06d959630121a61b863f562e74dd0e2aa2f87666569f27049c` |
| Runtime dependency stores | No `picomatch@` package in either running application container |
| Deployment phase | `accepted`; public ingress open |
| Services | API, collaboration, PostgreSQL, Redis and Typesense healthy; zero restarts |
| Public HTTP checks | Root HTML, runtime configuration, entry JavaScript, API health and collaboration health: 200 |
| Preserved data counts after canary cleanup | 37 users, 21 spaces, 772 pages, 483 attachments |
| Search queue after cleanup | Zero waiting/active/finite-delayed work, zero new failures; 10 pre-existing failures and one ordinary recurring delayed job retained |

The source, [GitHub Release](https://github.com/sherer-pro/docmost/releases/tag/v1.3.5)
and both release-source CI runs refer to the SHA above. This receipt is a later
documentation change; the deployed image retains its release-source provenance.

## Dependency correction and changed files

The original `f6e205a0bc0a3c099672e6438181c32118e6270d` production audit failed
on `picomatch@2.3.2` through
`@excalidraw/excalidraw@0.18.0-3a5ef40 -> sass@1.51.0 -> chokidar@3.6.0`,
then `anymatch@3.1.3` or `readdirp@3.6.0`.
[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
describes repeated-extglob ReDoS through picomatch 4.0.7. On 17 November, the
advisory listed no patched version and npm's latest was 4.0.7.

Commit `6c3b9a78f0d518403384f5d8ccce8be3221aa981` adds the parent-scoped root
override `@excalidraw/excalidraw>sass: 1.79.4`. Sass 1.79.4 uses Chokidar 4
and Readdirp 4 without picomatch. It supports the existing Immutable 4 policy,
retains the Excalidraw version and adds no native watcher dependency. The
lockfile changes cover this chain and its related peer snapshots.

The real dependency regression checks the watcher dependency closure and both
modern and legacy Sass compilation. `pnpm why picomatch --recursive --prod`
returns no path. Production audit reports zero high/critical findings and zero
exceptions; 10 low and 30 moderate findings remain. Development tools still
use vulnerable picomatch versions.

| Files | Change |
| --- | --- |
| `package.json`, `pnpm-lock.yaml` | Scoped Sass override, resolved dependency chain and release version |
| `apps/client/package.json`, `apps/server/package.json` | Aligned version 1.3.5 |
| `scripts/security-dependencies.test.mjs` | Actual dependency closure and Sass API regression |
| `apps/client/e2e/editor/specs/media-clipboard.spec.ts`, `apps/client/e2e/editor/README.md` | Static input for the single YouTube focus fixture and its documented boundary |
| `apps/client/e2e/database/run.mjs`, `docs/DATABASE_TABLES.md` | Prebundle `react-helmet-async` before Playwright startup |
| `apps/server/docs/release-notes/v1.3.4.md`, `apps/server/docs/release-notes/v1.3.5.md` | Security correction, QA changes and deployment requirements |
| This receipt | Actual verification and production outcome |

Application TypeScript, public API contracts and database migrations were
unchanged by this correction. Audit policy, assertions, timeouts and retry
settings were preserved.

## Release verification and QA boundaries

Node 22.23.2 and pnpm 10.4.0 were used locally. Frozen installation,
`verify:full`, English-comment checks, audit-exception validation and diff checks
passed. Full unit sets passed 2,606 server and 1,039 client tests; separate
security subsets passed 1,052 server and 82 client tests.

| Scope | Actual evidence |
| --- | --- |
| Final local isolated release | `artifacts/database/live/2026-11-17T22-10-44-531Z-19d07624/result.json`: passed, fullRelease=true, exact release SHA, exitCode=0 and completed cleanup |
| Release-source main CI | [44187388733](https://github.com/sherer-pro/docmost/actions/runs/44187388733): all three jobs successful, workflow attempt 1 |
| Release CI and image publication | [44193791805](https://github.com/sherer-pro/docmost/actions/runs/44193791805): all three required gate jobs and Publish verified image successful, workflow attempt 1 |
| Cold-cache CI-mode keyboard matrix | All 27 Chromium, Firefox and WebKit cases passed without late Vite optimization/reload |
| Local and main CI editor matrix | 67 passed without retries, two unchanged planned Firefox skips; downloaded Markdown, HTML, PDF and Docmost exports passed |
| Release CI editor matrix | 66 passed, one flaky Firefox `complex-document.spec.ts:51` passed retry 1, two unchanged planned skips |

The initial local release at `6c3b9a78` failed because an external YouTube frame
activated beneath the Firefox image modal. With explicit owner approval,
`c76f3fcea8936996c85585c091d28f32da0bf2f9` serves that single fixture locally
on the exact youtube.com/youtube-nocookie.com embed paths. Focus assertions are
unchanged. Focused Firefox acceptance and the complete local release then passed.
Actual remote YouTube playback/focus behavior remains outside this fixture.

The immutable `v1.3.4` release workflow subsequently failed twice at its first
Chromium keyboard save case. Vite optimized `react-helmet-async` after startup
and reloaded the fixture during the interaction; the other 26 cases passed.
One controlled failed-job rerun reproduced this failure. No 1.3.4 image was
published and its tag was not moved.

Commit `d07ac14bf7f93bdc36bbac5d41762154dadf5eb3` explicitly prebundles that
dependency before browser startup, using the existing synthetic-runner pattern,
and advances the release to 1.3.5. Cold local, full local, main CI and release CI
keyboard matrices all passed. Both successful CI focus sections contain all 27
passing cases and zero late optimizer/reload lines. Original failures and traces
were retained. The separate Firefox complex-document timing instability still
required its normal retry in release CI.

## Recovery protection and isolated application acceptance

Both installed 1.3.3 containers were inspected directly. Their image was
`shererpro/docmost@sha256:a254a8d57867ed2cce0d32bb64c4e22a65ecad2b2ab88c90f6f278018fb5bf72`,
OCI revision `f2ad2a4af145218535a7654b8a4c57a5738a91a7`. Both production stores
contained picomatch 2.3.2, Sass 1.51.0 and Chokidar 3.6.0, so runtime replacement
was required.

A fresh coordinated native archive was created and verified on 17 November at
23:05:16-23:07:43 MSK:

- Source: `/var/backups/docmost/before-picomatch-20261117.tar`.
- Size: 353,853,440 bytes.
- SHA-256: `e2c33a6debcefe151a88e73bdb84dd9e7201f5077c09e25c2baf5f7302284c89`.
- Only this archive was transferred to the owner's backup VPS after explicit
  payload/destination approval; the independent destination hash matched.
- No `.env` or secret-escrow baseline was exported in this transfer. The protected
  runtime/configuration baseline remained on the application host.

An initial operator wrapper lacked the maintenance hook's APP_URL and stopped
before changing production. The corrected create/verify completed and both
writers resumed healthy. The accepted native scheduled producer was preserved.

Actual isolated restore recovered 37 users, 21 spaces, 772 pages, 483 attachments
and 123 migrations. Every restored storage file matched its archive hash:
483 files, 340,209,983 bytes.

The published 1.3.5 image then passed application acceptance on that restored
copy at 23:41:02-23:41:53 UTC. Checks covered API/collaboration health, unchanged
core runtime secret bindings, real page reading, original attachment SHA,
canary page/attachment creation and readback, full Typesense reindex and search,
canary deletion, original SQL counts and a final idle search queue with no
failures. The project had fresh volumes, an internal network, no published
ports and explicit resource limits. Production state remained unchanged.
All five temporary containers, four owned volumes and the internal network were
removed after acceptance; archives and receipts were retained.

## Production migration and acceptance

The exact release checkout passed fresh preflight/plan immediately before
maintenance: PostgreSQL 18/glibc, 123 applied migrations, zero pending migrations,
no collation mismatch or invalid indexes, and sufficient capacity after image
pull and rehearsal cleanup.

The supported [deployment](../DEPLOYMENT.md) and
[PostgreSQL workflow](../../apps/server/docs/postgresql-production-migration.md)
selected the verified image under the deployment lock, closed ingress, stopped
writers, made fresh local database/storage backups and restored a new PostgreSQL
candidate with the mandatory inventory checks. It left phase `acceptance` for
application testing.

- Migration ID: `20261117234624550`.
- Fresh local migration backup: `/var/backups/docmost/postgres/20261117234624550`.
- The recorded retention deadline for the previous PostgreSQL volume is
  `2026-12-01T23:48:22.738Z`. Its existence and the previous application
  image's local digest were verified after acceptance.

The first live canary attempt read the existing page and original attachment
successfully, then received CSRF 403 on creation. The operator's loopback HTTP
client did not present the configured application Host alongside its Origin.
Native HTTP diagnostics without JWT returned 401 for the matching Host/Origin
and 403 for a foreign Origin. Only the private operator probe transport was
corrected; JSON and multipart unauthenticated requests still returned 401 and
foreign Origin still returned 403. Application security, APP_URL and source code
were unchanged. The original failed receipt was retained.

The corrected live acceptance passed at 23:55:53-23:55:56 UTC. Both actual
application stores had no picomatch. It verified an authenticated existing page,
an original attachment hash, a new canary page and attachment, readback,
Typesense presence for the original and canary, application search, deletion,
auth-session cleanup and restored SQL counts. Production search acceptance used
the existing index and canary; the full reindex was performed on the isolated
copy. A final post-cleanup queue check retained all 10 baseline failed jobs,
found zero new failures and zero waiting/active/finite-delayed work. No failed
jobs were deleted for this rollout.

Only after that PASS was the deployment accepted and ingress reopened. Final
checks at 23:57:05-23:57:07 UTC verified all five services, both new application
image IDs, public web/configuration/entry JavaScript and both health endpoints.
After accepting user writes, automatic rollback to the previous database is
forbidden; follow the runbook's forward-recovery boundary.

## Preserved operations and remaining limits

The effective historical-named `/opt/docmost/compose.release.v1.3.1.yml`, native
timer and native/host service drop-ins retained their baseline hashes. The
application environment file matched the exact post-selection hash: only
DOCMOST_IMAGE changed. The separate deployment state records the accepted new
PostgreSQL candidate and preserved previous runtime.

Native backup tool revision
`9f8b67a72dceae1e79b14f2d8e40a797e0325eba` and its active 05:00 MSK timer
were unchanged. Read-only native backup context validation selected the new
image and accepted state. Transport, rdiff history and retention policy were
unchanged; no cross-host contract or AllDocker source change was needed.
A post-upgrade scheduled archive was not manually created/verified by this task.

Remaining acceptance boundaries are the development picomatch dependencies,
40 low/moderate production audit findings, 10 pre-existing failed search jobs,
the normal Firefox complex-document retry and two planned skips, and the real
remote YouTube player focus behavior excluded by the approved static fixture.
No hands-on production desktop/mobile browser acceptance was performed; UI
coverage comes from the automated local and CI browser matrices.

The local evidence set is retained under the ignored
`artifacts/picomatch-20261117/`. Key local receipts include `release-gates.json`,
`image.json`, `rehearsal-app.json`, `migration-result.json`,
`production-acceptance.json`, `postflight.json` and `web-postflight.json`.
Application-host operator records are under `/root/docmost-picomatch-20261117/`,
including `rehearsal/app-result.json`; migration backup records are in the
directory listed above. Secret escrow and data archives remain protected
separately.
