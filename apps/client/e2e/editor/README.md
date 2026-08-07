# Editor regression audit

This suite exercises the fork-specific editor surface against a running Docmost
instance. It creates an isolated space, enables the page-template policy only
for the duration of the run, and restores the workspace policy afterwards.

Run from the repository root with credentials supplied only at runtime:

```sh
DOCMOST_AUTH_TOKEN=... DOCMOST_CSRF_TOKEN=... corepack pnpm --filter ./apps/client test:editor:e2e
```

Set `DOCMOST_BASE_URL` to override `http://localhost:3000`.
Set `DOCMOST_API_BASE_URL` when API transport must use a different loopback
address (for example, `http://127.0.0.1:3000` when `localhost` may resolve to
IPv6). Set `DOCMOST_API_ORIGIN` when the browser target is a Vite dev server but
API requests must retain the backend's trusted origin for CSRF validation.
WebKit uses `DOCMOST_WEBKIT_BASE_URL`, defaulting to the IPv4 loopback.

Evidence is written to `output/audit/editor-2026-08-06`. The audit space is
deleted only when Playwright passes and no confirmed defects were recorded. A
failed or defect-bearing run retains the space and records its ID in
`audit-state.json` for manual inspection.

The matrix covers Chromium and Firefox desktop, WebKit media/clipboard, and
Chromium/WebKit mobile emulation. Local Mermaid payloads and generated
PNG/WAV/PDF fixtures avoid public conversion services. Console failures, axe
results, screenshots, exports, and the Playwright HTML/JSON reports are stored
under the same audit directory.
