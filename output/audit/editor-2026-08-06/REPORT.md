# Editor regression audit — final report

Date: 2026-08-06/07 (Europe/Moscow)
Target: `http://localhost:3000`
Final run: `20260806223904`
Playwright: **11/11 passed in 1.7 minutes**
ED-006 remediation: **2/2 focused desktop checks passed** on the current source
in Chromium and Firefox.

## Findings

The successful regression run originally recorded seven browser observations
that mapped to four unique functional defects. `ED-006` is now fixed and
verified in the working tree. A fresh isolated recheck did not reproduce
`ED-002`, leaving two confirmed open functional defects. In
addition, axe found seven unique WCAG rule violations. A passing scenario means
the audit completed and preserved its evidence; it does not mean that the
editor is defect-free.

1. **Critical accessibility gaps across every scanned state.** Unnamed editor
   buttons, invalid/prohibited ARIA combinations and a sanitized Mermaid image
   without alt text occur in all eight axe scans. `button-name` alone covers 50
   node instances; `aria-allowed-attr` covers 34. See
   [accessibility-summary.md](accessibility-summary.md).
2. **Follow-up — `ED-002` was not reproduced.** A fresh isolated paragraph
   check set `data-indent="1"` after a trusted `Tab` press in both Chromium and
   Firefox, with zero console errors; the focused TipTap unit test also passed.
   No related production code changed after the baseline, so the original
   observation is retained as a historical, potentially state-dependent result
   rather than an open general defect.
3. **Resolved — `ED-006`: copied Draw.io attachment identity.** Draw.io save now
   applies copy-on-write when another node references the same `attachmentId`.
   The source keeps its original attachment while the saved copy receives a new
   one. A focused regression passed in Chromium and Firefox; see
   [ed-006-remediation.md](ed-006-remediation.md).
4. **Medium — `ED-005`: table column resize is disabled.** Both desktop engines
   rendered no resize handle; source config uses
   `CustomTable.configure({ resizable: false })`. Table structural operations
   still passed.
5. **Medium — `ED-007`: production CSP breaks WebKit on the configured local
   HTTP origin.** WebKit upgrades scripts/styles/manifest/config to HTTPS, but
   the local target has no TLS endpoint. WebKit feature coverage therefore
   uses a disclosed route shim that removes only `upgrade-insecure-requests`;
   every other CSP directive remains active.

## Coverage outcome

- fixed/unfixed toolbar, preference persistence and toolbar keyboard focus;
- all 39 expected node types and 11 mark types in one document;
- heading numbering, nested levels, reset and persistence;
- indent/outdent, page-break create/copy/delete and archive/PDF export;
- table creation/paste/merge/add/remove/wide/read-edit behavior;
- block width, internal PDF viewer, image fullscreen, audio and media alt text;
- Draw.io copy/save, Excalidraw render/alt, valid/invalid/malicious Mermaid;
- internal/external link previews, subpage navigation and synced blocks;
- slash commands, 120-section paste, malicious HTML paste, undo/redo;
- two-user collaboration, readonly/public share, reload/offline recovery;
- mobile/touch rendering without document-level horizontal overflow.

Desktop coverage ran in Chromium 151 and Firefox 153. WebKit 26.5 ran the
media/clipboard path and the iPhone 15 mobile path. Pixel 7 mobile Chromium ran
the same simultaneous all-node document.

## Visual evidence

Authenticated all-node document:

![Chromium all-node editor](screenshots/chromium-desktop-01-all-node-document.png)

Mobile all-node reflow:

![Mobile Chromium reflow](screenshots/mobile-chromium-05-mobile-touch-reflow.png)

Offline fallbacks were captured and recovered in both engines:

- [Chromium offline screenshot](screenshots/chromium-desktop-08-offline-interruption.png)
- [Firefox offline screenshot](screenshots/firefox-desktop-08-offline-interruption.png)

All **23 final screenshots** were manually inspected. Earlier failure images
are not present because the runner clears only its generated evidence folders
before a new isolated run.

## Accessibility and console (baseline full run)

- 8 axe scans: 7 unique rules, 50 rule occurrences, 145 affected-node
  instances, 200 passing checks and 24 incomplete/manual checks.
- 11 console files: 240 raw events (112 request failures, 25 errors, 103
  warnings), with zero uncaught `pageerror` events.
- Most network failures are induced by offline/reload/navigation or external
  YouTube/Draw.io teardown. Remaining media/parser/WebKit noise is classified
  in [console-summary.md](console-summary.md).

## Export verification

Markdown, HTML and PDF archive export passed in Chromium and Firefox. HTML was
parsed and contained no executable event or `javascript:` attributes. Official
Poppler `pdfinfo` confirmed two six-page tagged A4 editor PDFs and two one-page
Letter source PDFs, all with `JavaScript: no`.

## Evidence index

- [Node-type coverage matrix](node-type-coverage-matrix.md)
- [Browser matrix](browser-matrix.md)
- [Static analysis](static-analysis.md)
- [History and migration map](history-map.md)
- [Executed tests](test-summary.md)
- [Console summary](console-summary.md)
- [Accessibility summary](accessibility-summary.md)
- [ED-006 remediation](ed-006-remediation.md)
- [Added-tests diff](added-tests.diff)
- [Latest focused Playwright HTML report](playwright-html/index.html)
- [Latest focused Playwright JSON](playwright-results.json)
- [Confirmed defect observations](confirmed-defects.json)

## Residual limitations and state

- The generated MP4 fixture validates video-node/alt rendering but is not a
  decodable Firefox playback sample.
- Headless WebKit could not start audio playback; Chromium and Firefox did.
- Excalidraw serialization/render/alt was covered, but its interactive editing
  session was not automated.
- The isolated space `019fd93a-eab9-71b2-b899-28985cd739dc` is retained for
  diagnosis because confirmed defects exist. Credentials were runtime-only and
  are absent from the repository and evidence artifacts.
