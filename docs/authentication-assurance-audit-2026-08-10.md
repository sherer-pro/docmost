# G21 Authentication Assurance Audit - 2026-08-10

## 1. Verdict

**PASS WITH RISKS** for the G21 local-authentication scope after remediation.
No reproducible open Blocker or High issue remains in the audited code and the
isolated production image. The release-wide `verify:full` gate remains red due
to an unrelated, pre-existing AI administrator-guide localization assertion
(`30` expected keys, `31` present). That failure is owned outside G21 and was
not changed here.

Residual G21 assurance risks are limited to scenarios that could not be made
representative locally: a real external SSO identity provider, native password
manager prompts, physical/mobile-device behavior, and an actual shared
`APP_SECRET` rotation. These are not represented as passes.

## 2. Frozen and working scope

- Release tag: `v1.0.0` at `446f6ddd68d87b28d6d1e2add90c235495149970`.
- Frozen audit head: `e955a0c8d13be6384a08988f40b4331b9b686ce8`.
- Frozen history range inspected: `v1.0.0^..e955a0c8`.
- Required commits inspected with `git show --stat --summary` and full diffs:
  `60ff6a43` and `a4a36400`.
- Main at worktree creation: `603c4fce40292f248024a78500e9665b656485da`
  (`v1.0.0-132-g603c4fce`).
- Audit branch: `codex/g21-auth-assurance` in
  `D:\DevProjects\docmost-qa-G21`.
- Branch before the documentation commit: `6417a2d4cce13406238e571aa84b3dfca48162d2`
  (`v1.0.0-141-g6417a2d4`).
- `e955a0c8..603c4fce` was checked for changes under the owned paths. No later
  commit superseded the two named authentication changes or eliminated the
  defects reported below.

Files and contracts read included:

- Server: `core/auth`, `core/mfa`, `core/session`, JWT and collaboration auth,
  user-token/session repositories, invitation services/DTOs, authentication
  assurance, CSRF, host parsing, trusted proxy resolution, credential
  protection, cookie policy, environment validation, and rate-limit telemetry.
- Client: login, logout, setup, invite acceptance, forgot/reset password, MFA
  challenge/enrollment/settings, authentication step-up, session list, route
  guards, API client assurance handling, and all 12 locale catalogs.
- Persistence/infrastructure: `users`, `auth_accounts`, `user_sessions`,
  `user_tokens`, `user_mfa`, `workspace_invitations`, `queue_outbox`, migration
  `20260806T230000-auth-credential-hardening`, Redis rate-limit keys, session
  invalidation pub/sub, BullMQ mail delivery, and collaboration authorization.
- Documentation/contracts: root and project `AGENTS.md`, `README.md`,
  `ARCHITECTURE.md`, generated API inventory, security regression runbook,
  environment examples/validation, package scripts, and e2e configuration.

### Implementation map

| Surface | API/contracts | Service/repository | State and dependencies |
| --- | --- | --- | --- |
| Login/logout/setup | `/api/auth/login`, `/logout`, `/setup` and auth DTOs | `MfaService`, `AuthService`, `SessionService`, `TokenService` | `users`, `auth_accounts`, `user_sessions`, signed cookies |
| Forgot/reset password | `/api/auth/forgot-password`, `/password-reset`, `/verify-token` | `AuthService`, `UserTokenRepo`, `MailService` | hashed `user_tokens`, password hash, BullMQ mail queue, session invalidation |
| Invitation | workspace invite create/link/info/accept routes | invitation service, signup/user/session services, transactional outbox | `workspace_invitations`, `users`, `queue_outbox`, mail worker |
| MFA | `/api/mfa/setup`, `/enable`, `/setup-required`, `/enable-required`, `/verify`, `/cancel-login`, `/step-up`, `/validate-access`, backup-code routes | `MfaService`, `TokenService`, `AuthenticationAssuranceService` | encrypted TOTP seed, APP_SECRET-keyed backup hashes, one-time `mfa-challenge` rows, session assurance |
| Sessions/realtime | `/api/sessions`, `/revoke`, `/revoke-all`, `/auth/collab-token` | `SessionService`, `UserSessionRepo`, JWT strategy, Socket.IO and collaboration auth | `user_sessions`, Redis invalidation, JWT/collab `sessionId` binding |
| CSRF/host/proxy | global `CsrfGuard` and double-submit token | host and trusted-proxy utilities, environment/domain services | `APP_URL`, `CLOUD`, `SUBDOMAIN_HOST`, `TRUSTED_PROXIES` |
| Auth throttling | per-route `AuthRateLimitGuard` metadata | `AuthRateLimitService`, telemetry listener | atomic Redis Lua counters in production; memory only for allowed development |

Key policy/configuration points:

- Workspace/space `enforce_mfa` and `enforce_sso` policies control bootstrap and
  step-up behavior. `APP_SECRET` protects signed tokens, encrypted TOTP seeds,
  and keyed recovery-code hashes.
- MFA login challenges expire after five minutes and are now persisted and
  consumed once. TOTP accepts the documented clock window while the stored
  counter prevents replay. Backup codes are atomically removed after use.
- Login is limited to 10/IP and 5/account per 10 minutes. MFA verify is limited
  to 10/IP and 5/account per 10 minutes. Other auth routes use the limits in
  `auth-rate-limit.config.ts`.
- Production requires `AUTH_RATE_LIMIT_STORAGE=redis`. An unavailable Redis is
  fail-closed and now reported as HTTP 503 rather than a false abuse response.
- Authentication logs and telemetry contain endpoint/scope/retry metadata, not
  account identifiers, tokens, passwords, invitation links, or recovery values.

## 3. Environment and tools

- Host: Windows 11 Pro, Node `v24.16.0`, Corepack pnpm `10.4.0`, Docker Desktop
  `29.5.3`.
- Isolated Compose project: `docmost-g21`; API `127.0.0.1:32121`, collaboration
  `32122`, PostgreSQL `32123`, Redis `32124`. The shared `docmost` project and
  its data were not stopped or mutated.
- Final browser-tested application image: `docmost-g21:342165a0`, digest
  `sha256:e0afb072c92d0f921c73c18e99c3c33c4039656c717f7ea0a2371ee2ed9821eb`.
- Pinned base images: PostgreSQL 18 Alpine digest
  `sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15`
  and Redis 8 Alpine digest
  `sha256:978f0e01593e65eed801f2402944efcd936d43b5027e4908a7897baf88ed6241`.
- Browser: Codex in-app Browser against the loopback-only isolated stack. Its
  UI reported Chrome on Windows session metadata; the runtime did not expose a
  reliable browser build identifier or mobile viewport artifact.
- TOTP: repository dependency `otpauth@9.4.1`; seeds and codes were generated
  locally. Node built-in `fetch`, raw `http`, and crypto were used for bounded
  protocol assertions. No public service received source, credentials, or test
  data.
- No new MCP server, SaaS, k6, Artillery, or Toxiproxy dependency was added.
  Docker stop/start provided the required Redis fault injection.
- Test data used synthetic `@audit.invalid` accounts and random canaries. The
  shared QA credential file was loaded only into the final repository-native
  artifact scanner; its values were never printed or copied into artifacts.

## 4. Coverage matrix

| Requirement/scenario | Static/unit/integration/browser/fault/security evidence | Result |
| --- | --- | --- |
| Login/logout/setup, valid and invalid credentials | History/diff review; auth unit tests; real setup and login/logout UI | Pass |
| Forgot password avoids enumeration | Same UI confirmation for existing/missing accounts; identical API contract; log scan | Pass |
| Reset tokens valid, expired, reused, forged, cross-user | Repository/API assertions plus real reset UI; invalid-token screenshot | Pass |
| Invite valid, expired, reused, forged, cross-user | Invitation service tests, API assertions, owner/member acceptance UI | Pass |
| Open redirect and `returnTo` | `return-to` tests, space policy resolution, direct URL attempts | Pass |
| TOTP enrollment QR/manual secret/verify/cancel/retry | Real required-enrollment browser flow and final-image retry; unit tests | Pass after fixes |
| Required MFA after local login | Real enforced-workspace browser flow and reload/direct-route checks | Pass after fix |
| Required MFA after SSO | Static policy and SSO unit coverage only; no real IdP | Risk/not fully tested |
| Clock skew, wrong and replayed TOTP | TOTP window tests, wrong code, live replay, concurrent replay unit test | Pass |
| Backup code use/regeneration/legacy migration | Live one-time use/reuse, service tests, migration and keyed-hash DB checks | Pass |
| MFA login challenge reuse with a second valid code | Live API: first verify 200, same challenge second verify 400; concurrent test | Pass after fix |
| Session list/current metadata | Two browser roles/contexts, setup/reset/login sessions, reload | Pass after fix |
| Revoke one/all-other and current-session protection | API/UI tests with multiple contexts | Pass |
| Revoked JWT/socket/collab immediately fails | Live second context and collaboration provider plus unit/security tests | Pass |
| CSRF token/origin/referer/Host/cloud host | Unit, e2e, and raw HTTP Host assertions | Pass after fix |
| Trusted proxy and forwarded headers | Empty, `uniquelocal`, and inapplicable `loopback` Docker-bridge cases | Pass with documented topology limit |
| Redis lazy first command/concurrency/window | Unit plus live first command, bounded bursts, TTL expiry | Pass |
| Redis outage and recovery | Isolated Redis stop/start: 503 while down, 200 after recovery | Pass after fix |
| Per-IP/account isolation and brute-force containment | Synthetic accounts only; unrelated account remained usable | Pass |
| UTF-8 password bytes, email/token bounds | DTO tests and client byte validation | Pass after fix |
| Logging, queue payload, DB storage canaries | Repository scanners plus exact synthetic scan across evidence, DB and outbox | Pass |
| Password manager/autofill and keyboard/a11y | HTML name/autocomplete, unique MFA digit labels, named close button, dialog/step-up browser flow | Pass with native-manager/mobile limitation |
| APP_SECRET rotation | Static cryptographic dependency analysis and runbook update; no shared rotation | Documented risk; destructive test not run |

## 5. Commands and exit codes

All read-only `git status`, `rev-parse`, `describe`, `log`, `show`, `diff`, `rg`,
file inspection, Docker inspect/log, PostgreSQL read, and Redis key-inspection
commands completed with exit code 0 unless explicitly noted below.

| Command | Exit | Evidence/result |
| --- | ---: | --- |
| `git status --short`; `git rev-parse HEAD`; `git describe --tags --always` | 0 | Captured before worktree creation; existing main Graphify changes preserved |
| `git worktree add -b codex/g21-auth-assurance ../docmost-qa-G21 main` | 0 | Isolated branch from current main |
| `git show --stat --summary` and full diffs for `60ff6a43`, `a4a36400` | 0 | History and assertions reviewed |
| `corepack pnpm --filter ./apps/server test -- --runInBand auth mfa session csrf` (baseline) | 0 | 14 suites, 70 tests |
| Same server targeted command (final) | 0 | 15 suites, 78 tests |
| `corepack pnpm --filter ./apps/client test -- auth mfa session` (baseline and final) | 1 | Same unrelated AI localization failure; final 125 passed files/1 failed, 600 passed tests/1 failed |
| Explicit five-file G21 client test command | 0 | 5 files, 30 tests |
| `corepack pnpm run test:security` (final) | 0 | Server 66 suites/778 tests; client 6 files/74 tests |
| `corepack pnpm --filter ./apps/server test:e2e` (first post-fix) | 1 | CSRF test mock lacked the newly used environment methods and Host fixture |
| Same server e2e command after test-harness correction | 0 | 4 suites, 17 tests |
| `corepack pnpm --filter ./apps/server test -- --runInBand apps/server/src/core/mfa/mfa.service.spec.ts` | 0 | 10 tests, including enrollment conflict target |
| `corepack pnpm --filter ./apps/server lint`; client lint | 0 | No G21 lint errors |
| `corepack pnpm server:build`; `corepack pnpm client:build` | 0 | Both production builds succeeded |
| `corepack pnpm routes:inventory`; `routes:inventory:check` | 0 | 311 routes; generated inventory current |
| `corepack pnpm check:env` | 0 | 5 tests and runtime contract passed |
| `corepack pnpm check:comments:en` | 0 | Passed before this English report was added |
| `corepack pnpm test:text-contracts` | 0 | Passed |
| `corepack pnpm verify:full` | 1 | Build, lint, server 215 suites/1681 tests passed; stopped on the same unrelated client AI localization assertion |
| `docker compose ... build docmost` for `af8a48fb` and `342165a0` | 0 | Images rebuilt after each production-code correction |
| `docker compose ... up -d docmost collab` | 0 | API/collaboration healthy on final image |
| Isolated Redis `stop`, auth request, `start`, health wait | 0 | HTTP 503 while unavailable; recovery HTTP 200 |
| Repository trace sanitizer and secret scanner | 0 | Clean, two shared QA secrets checked, no trace archive |
| Exact synthetic evidence scan | 0 | 19 canary values checked; no findings |
| DB/outbox exact canary scan | 0 | 6 tables, 18 rows; no findings |

Baseline/test-only failures were not hidden. The client AI localization failure
was present before G21 test-only changes. The first post-fix e2e failure was a
stale test harness, not a production request path; it was corrected and rerun.
The first new production image also exposed an invalid MFA upsert conflict
target; that self-introduced regression was fixed before integration and a
dedicated unit regression test was added.

## 6. Findings

| ID | Severity | Component | Reproducibility | Expected / actual | Root cause | Status and fix |
| --- | --- | --- | --- | --- | --- | --- |
| G21-01 | High | MFA login | 100%, API and two valid backup codes | Challenge usable once / same signed pre-auth cookie created two sessions | MFA JWT was stateless and no challenge row was atomically consumed | Fixed `68858c31` |
| G21-02 | High | CSRF | 100%, raw HTTP | Origin, configured app host, and request Host must agree / configured Origin bypassed a spoofed Host | Early APP_URL-origin success ignored request Host | Fixed `a24bd6b3` |
| G21-03 | Medium | Auth rate limit | 100%, Redis stopped | Infrastructure outage should be distinguishable / fail-closed response was false HTTP 429 abuse | Service returned only `allowed=false` for both limit and storage failure | Fixed `98e9a375` |
| G21-04 | Medium | Sessions | 100%, setup/reset UI | Current device metadata recorded / `Unknown device` | controller/service omitted `FastifyRequest` when creating setup/reset sessions | Fixed `710e0d00` |
| G21-05 | Medium | Login | 100%, repeated timing samples | Comparable missing/existing cost / about 5-7 ms versus 137-145 ms | Missing user returned before bcrypt | Fixed `9055798d` |
| G21-06 | Medium | Auth inputs | 100%, DTO validation | Bcrypt/token/email boundaries enforced consistently / login/current password and several public tokens were unbounded | Incomplete DTO byte/length validators and client character-only assumptions | Fixed `9055798d`, `af8a48fb` |
| G21-07 | Medium | Required MFA cancel | 100%, browser reload/direct URL | Cancel invalidates pre-auth state / navigation left a reusable challenge cookie | Client-only navigation without server-side challenge consumption/cookie clear | Fixed `68858c31` |
| G21-08 | Low | Auth/MFA/session UX | 100%, browser/a11y inspection | Recoverable, named, password-manager-friendly controls / no step-up logout, unnamed close, duplicate PinInput labels, no retry, misleading all-device copy | Missing UI contracts and inconsistent copy | Fixed `af8a48fb` |
| G21-09 | Low | Operations/docs | Static | Rotation blast radius documented / APP_SECRET impact on MFA recovery omitted | Runbook covered regression classes but not key rotation | Fixed in this documentation commit |
| G21-R1 | High (caught before integration) | MFA enrollment upsert | 100% on first fixed image | Required enrollment succeeds / PostgreSQL 500 due invalid conflict target | Code targeted `(user_id, workspace_id)` while schema uniqueness is `user_id` | Fixed `342165a0`, test `183a6b9c` |
| G21-T1 | Low, test-only | CSRF e2e harness | 100% after host fix | Harness models effective host/environment / random Supertest Host and incomplete mock caused 500 | Stale test fixture after production guard became stricter | Fixed `6417a2d4` |

### Reproduction and impact details

**G21-01.** Log in to the isolated enforced workspace, retain the MFA pre-auth
cookies, verify backup code A, then submit backup code B with the original
cookies. Before the fix both calls returned 200 and created sessions. After the
fix the first returns 200 and the second returns 400. A stolen five-minute MFA
challenge could previously be exchanged more than once when the attacker also
possessed multiple current codes.

**G21-02.** Send a mutating authenticated request with matching cookie/header,
`Origin: http://localhost:32121`, and `Host: attacker.invalid`. Before the fix
the configured APP_URL branch accepted it. After the fix the raw request is 403
while the correct Host control is 200. This closes Host-confusion/DNS or proxy
misrouting paths around the double-submit check.

**G21-03.** Stop only `docmost-g21-redis-1` and call login. Before the fix the
response was 429, indistinguishable from attack traffic. After the fix it is
503 with a stable infrastructure message, remains fail-closed, and returns 200
again after Redis is healthy. No fallback-to-memory was introduced.

**G21-04.** Complete initial setup or a non-MFA password reset in the browser,
then open Active sessions. Before the fix the current row was `Unknown device`.
After request propagation it is `Chrome on Windows` and marked current.

**G21-05.** With fresh Redis counters, alternate three wrong-password requests
for an existing isolated account and three for missing accounts. Baseline was
roughly 137-145 ms versus 5-7 ms. Final averages were 142 ms and 139 ms using a
fixed bcrypt cost-12 dummy hash. Error text remains uniform.

**G21-06.** Submit UTF-8 passwords around bcrypt's 72-byte limit, 255-byte
emails, and 513-byte public tokens. Final DTO/client tests reject the first byte
past each supported boundary before expensive lookup/hash work.

**G21-07/G21-08.** In required setup, cancel and revisit the direct setup URL.
Baseline retained the pre-auth state. Final behavior calls `/mfa/cancel-login`,
consumes the challenge, clears cookies, and redirects direct revisit to login.
The modal now exposes a named close action, six distinct digit labels, retry,
and the assurance page exposes logout.

## 7. Scenarios checked without a defect

- Valid login/logout, workspace setup, invite acceptance, forgot password, and
  password reset on synthetic accounts.
- Expired, reused, forged, wrong-type, and cross-user reset/invitation tokens;
  no account-enumerating forgot-password response.
- TOTP wrong code, accepted clock window, counter replay, concurrent replay,
  backup code one-time use, regeneration, encrypted seed storage, keyed hashes,
  and legacy-hash migration behavior.
- Active-session list, current marker, revoke one, revoke all other sessions,
  multiple contexts, and immediate rejection of revoked JWT, Socket.IO, new and
  already-connected collaboration authorization.
- CSRF missing/wrong token, missing Origin/Referer, foreign origin, correct
  same-origin, spoofed Host, cloud host match/mismatch unit cases, and trusted
  proxy attribution.
- Redis first lazy command, atomic concurrent IP/account bursts, TTL expiry,
  outage fail-closed behavior, restart/recovery, and isolation from unrelated
  accounts.
- Safe relative `returnTo`, invalid external return, email/password/token byte
  limits, duplicate accounts, and log/output redaction.
- Browser reload/reconnect, required MFA direct URLs, dialog accessibility,
  login autofill attributes, and session copy.

## 8. Remediation report

- `68858c31`: persisted five-minute MFA challenges in existing `user_tokens`,
  added an identifier to the signed MFA token, atomically consumed challenge
  plus TOTP/backup/enrollment, and added `/api/mfa/cancel-login`. No migration
  or public schema change. Rollback removes challenge single-use protection and
  is not recommended.
- `a24bd6b3`: bound configured origin to normalized request/source/app hosts.
  Cloud workspace logic remains separate and covered. Rollback reopens G21-02.
- `98e9a375`: added `storageAvailable` to the internal limiter result and HTTP
  503 handling. Redis remains mandatory/fail-closed in production.
- `710e0d00`: propagated the real Fastify request into setup/reset session
  creation. No token/session contract changed.
- `9055798d`: added a fixed bcrypt dummy comparison and consistent DTO limits.
  The dummy hash uses the production bcrypt cost and creates no state.
- `af8a48fb`: aligned password-manager attributes and UTF-8 validation; added
  accessible/recoverable MFA and step-up controls; corrected all-device copy in
  every locale.
- `342165a0` + `183a6b9c`: targeted the actual `user_mfa.user_id` uniqueness
  key and locked the contract with a unit test.
- `6417a2d4`: made the CSRF e2e harness model Host and the complete environment
  surface; added a live guard rejection case.
- This documentation change updates the generated route inventory and adds a
  controlled APP_SECRET rotation/recovery procedure.

Acceptance criteria were the final targeted/security/e2e results, successful
production builds, successful real enrollment/cancel/reset/session flows on
the final image, raw protocol assertions, and clean artifact/DB/log scans.
Existing telemetry remains sufficient for rate-limit outage/exceeded events;
no sensitive account identifiers were added.

## 9. Limitations and remaining work

- A real OIDC/SAML/LDAP provider was unavailable. SSO-required setup and
  account-switch/replay behavior therefore remain unit/static evidence, not a
  live IdP pass. Owner: SSO/environment validation.
- No physical mobile device or reliable in-app mobile viewport was available.
  Responsive code was inspected, but mobile keyboard/autofill/layout needs a
  device smoke before claiming mobile release acceptance.
- Native password-manager save/fill prompts were unavailable. HTML
  `name`/`autocomplete` contracts were verified in the browser.
- `APP_SECRET` was not rotated in the shared environment. The cryptographic
  blast radius and recovery procedure are documented; an isolated restored
  snapshot drill remains required before an operator rotation.
- `verify:release` was not run because its documented production-like browser
  acceptance environment and external integration variables were not available
  for this isolated G21 stack. Its available local constituents were run
  separately. `verify:full` is red only on the unrelated AI localization gate.
- The server full suite reports a forced Jest worker exit/open-handle warning
  despite all 215 suites passing. This is outside G21 but should be tracked by
  the test-infrastructure owner.

## 10. Evidence and secret handling

Evidence root: `output/g21-auth-20260809` (ignored test artifact, not committed).

- `api-fault-results.json`: redacted protocol/fault/timing results.
- `browser-audit-results.json`: role/context flow summary and limitations.
- `screenshots/`: safe UI states only. QR codes, manual MFA secrets, backup
  codes, failed/redundant captures, and unusable mobile captures were deleted.
- `trace-sanitization.json`: no trace archives; zero replacements.
- `secret-scan.json`: repository scanner clean for the two loaded QA secrets.
- `synthetic-secret-scan.json`: clean for 19 exact synthetic canary values.
- `db-queue-secret-scan.json`: clean across six auth/outbox tables and 18 rows.
- Container-log pattern scan: clean for cookie/token/canary patterns.

No password, cookie, JWT, TOTP seed, recovery code, invitation/reset token,
APP_SECRET, or shared credential is present in this report or retained evidence.

## 11. Commits and integration

Production commits:

- `68858c31` - `fix(auth): make MFA login challenges single-use`
- `a24bd6b3` - `fix(security): bind CSRF origin to request host`
- `98e9a375` - `fix(auth): distinguish rate limiter outages`
- `710e0d00` - `fix(auth): preserve session metadata on setup and reset`
- `9055798d` - `fix(auth): bound credentials and equalize login checks`
- `af8a48fb` - `fix(client): harden authentication UX`
- `342165a0` - `fix(auth): target the MFA user uniqueness constraint`

Test-only commits:

- `183a6b9c` - `test(auth): cover MFA enrollment conflict target`
- `6417a2d4` - `test(security): cover CSRF host binding in e2e`

The final documentation commit and the local-main merge commit are recorded in
the handoff after integration. No push, pull request, tag, or release was made.
