# ED-002 / ED-005 / ED-007 recheck

Date: 2026-08-07 (Europe/Moscow)
Target: `http://localhost:3000`

## Outcome

- `ED-002` was not reproduced. A fresh isolated editable paragraph reached
  `data-indent="1"` after a trusted `Tab` press in Chromium and Firefox. Both
  runs produced zero console errors, and the focused TipTap indentation unit
  test passed. No related production code changed after the baseline, so this
  is not classified as a verified code fix.
- `ED-005` remains current. Neither desktop engine rendered a
  `.column-resize-handle`, and the client still configures
  `CustomTable.configure({ resizable: false })`.
- `ED-007` remains current for the configured plain-HTTP local origin. The
  response CSP contains `upgrade-insecure-requests`; unshimmed WebKit upgraded
  the manifest, JavaScript, CSS and window config requests to
  `https://127.0.0.1:3000`, where no TLS endpoint exists. This evidence does not
  imply a failure on a production HTTPS deployment.

## Accepted screenshots

- `01-02-chromium-indent-table.png`
- `01-02-firefox-indent-table.png`

The `00-*-loaded.png` captures were taken before the editor finished loading,
and `03-webkit-http-csp.png` is blank because the upgraded subresources failed.
They are retained locally but are not accepted or committed as visual evidence;
the WebKit finding is supported by captured network errors instead.

Temporary pages were deleted after the check, preferences were restored, and
the evidence scan found no JWT-like credentials.
