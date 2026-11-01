# Stale-client recovery

The client listens for Vite's production `vite:preloadError` event. On an
active document it attempts one reload, recording a session-storage marker
beforehand. An unexpired marker or unavailable storage prevents another
automatic reload. The existing 30-second recovery window and 10-second
post-load marker reset are unchanged.

Firefox can reject an in-flight dynamic import immediately after
`beforeunload`, before the destination document commits. That rejection does
not establish that the current deployment has stale assets. Reloading the
departing document aborts the intended navigation with `NS_BINDING_ABORTED`.
When the preload event is suppressed during that reload, the Vite import
wrapper can also resolve without a module and fail at a named lazy export.

The recovery handler now tracks document departure. It neither reloads nor
reserves a recovery marker while the document is leaving. The departure
listener is one-shot; `pageshow` rearms it. Trusted pointer or keyboard input
on the current document also rearms it, allowing recovery after a cancelled
navigation when the user resumes working. Synthetic input does not clear
departure. This does not change routes, API authorization, AI context policy
or the normal active-document recovery limits.

## Reproduction and verification

`node apps/client/e2e/stale-client-recovery/run.mjs` builds a small production
Vite fixture that imports the actual recovery source. It loads no application
`.env`, creates no account and changes no user browser, service or model
settings. Owned HTTP servers listen on ephemeral loopback ports, and each
case uses an isolated browser context. Receipts and generated fixtures remain
under ignored `artifacts/pwa-recovery/<timestamp>`.

The default suite checks six cases in Chromium, Firefox and WebKit:

- Leaving with a pending module request, reaching the destination and Back.
- Ordinary missing-asset recovery and the existing reload throttle.
- Resumption through trusted pointer input.
- Resumption through trusted keyboard input.
- Failure to resume through synthetic input.
- Recovery resumption on `pageshow`.

The deliberately delayed destination is a structural navigation test, not a
latency measurement. The fixture does not require native back-forward cache
restoration; `pageshow` state handling has a separate controlled case.
Use `--browser=firefox` for a focused diagnostic. The full suite runs through
`pnpm test:pwa:e2e`, `verify:release` and the CI browser job. Unit coverage
is in `apps/client/src/lib/pwa/stale-client-recovery.test.ts`.

The retained before/after probe receipts are
`artifacts/preload-navigation-before.json` and
`artifacts/preload-navigation-after.json`. The unchanged pre-fix source
reproduced both the Firefox aborted navigation and undefined lazy export;
the corrected source reached the destination in Firefox and Chromium.
These focused receipts do not replace final application/browser acceptance.
