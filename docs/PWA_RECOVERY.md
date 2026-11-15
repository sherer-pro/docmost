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

## Runtime configuration readiness

The server injects a parser-loaded `/window-config.js` script into the HTML.
The script can fail independently of the cached application shell and bundles.
Previously the client started anyway: home and space routes worked, but every
document failed when editor initialization called `getCollaborationUrl()` with
no `window.CONFIG.COLLAB_URL`. Navigating to another document could not restore
the missing configuration. A full document reload fetched the script again.

The production entry point now checks the required public `APP_URL` and
`COLLAB_URL` values before calling `createAppRoutes()` or creating the router. This also
ensures that cloud-dependent routes are built with the recovered configuration.
An already valid configuration adds no request. Otherwise the client reloads
the same-origin script, with three attempts, a five-second timeout per attempt
and 250/1000 ms backoff. Concurrent callers share one recovery operation.

After bounded recovery fails, the startup error offers another attempt without
reloading the document. The `online` event also resumes startup automatically.
Successful startup removes this listener so later network changes cannot
remount the application. The URL, query and fragment are retained throughout.
Development continues to use Vite's environment configuration.

The configuration remains network-only: it is not copied into CacheStorage,
localStorage or sessionStorage, and no collaboration origin is guessed from
the current page. API authorization and collaboration authentication are unchanged.

The original behavior was reproduced in the complete production client with
synthetic API data by failing only the initial configuration script. Home and
space opened, documents threw `COLLAB_URL is required`, and a full reload
restored them. This establishes a concrete failure mechanism matching that
symptom; it does not provide the error log of a user's installed PWA.

## Manual recovery from a page failure

The page error boundary's **Try again** button reloads the current document,
preserving its URL. A boundary reset alone cannot recover a rejected
`React.lazy` import: React keeps the rejected promise even after the network
recovers. This can leave a page stuck after automatic preload recovery is
throttled or unavailable. Manual reload is independent of that automatic
recovery limit and does not clear storage or unregister the Service Worker.

Ordinary page-data request failures still retry the query without reloading.
Navigating to another page still resets the page error boundary. Render
failures do not trigger automatic document reloads.

`apps/client/src/pages/page/page.test.tsx` covers cached lazy-import rejection,
render failure, query retry and navigation reset using the actual page
component. These cases establish recovery behavior; they do not identify
other causes of failures on an installed PWA without its error or network evidence.

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

The command also runs `runtime-config.mjs`, which builds the actual production
entry point with synthetic routes and no application API, account or Service
Worker registration. It checks five startup cases in all three browsers:
preloaded configuration, transient failure, invalid configuration, automatic
online recovery and the manual retry action. Each case checks route evaluation
after configuration, one document request, the original collaboration origin,
and no application remount after later online events. Its receipts include
entry-point/config-loader source hashes under `artifacts/pwa-runtime-config/`.
Together both fixtures cover 33 browser cases. Loader unit coverage is in
`apps/client/src/lib/pwa/runtime-config.test.ts`.

The retained before/after probe receipts are
`artifacts/preload-navigation-before.json` and
`artifacts/preload-navigation-after.json`. The unchanged pre-fix source
reproduced both the Firefox aborted navigation and undefined lazy export;
the corrected source reached the destination in Firefox and Chromium.
These focused receipts do not replace final application/browser acceptance.
