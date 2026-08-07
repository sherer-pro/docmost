# Database E2E report

Run: `20260806-220716`
Target: `http://localhost:3000`
Final observed Git HEAD: `db3abf1bd190130d061005c08b2343c018dec47a` (`main`)
Final observed runtime image: `sha256:c9f5cfacf888c47eaefc247a447ba449733bfa3867d2bbd92e5e25fa2648c7fc`
Harness: `@playwright/test@1.62.1`, `@axe-core/playwright@4.12.1`, Chromium only.

Product files, dependencies and lockfile were not changed by this test run. The isolated harness is under `tmp/database-e2e-20260806-220716`; evidence is under `output/database-e2e-20260806-220716`. The repository was already dirty and continued to change externally during the run; phase boundaries are recorded in `runtime-phases.md`.

## Verdict

The database implementation is broadly functional, but this is **not a passing release verdict**. Core CRUD, all six property types, bulk update/delete/Undo, persisted column order, same-space duplication with attachment integrity, current-view export, conversion round-trip on desktop/tablet, history, read-only mode and the tested concurrency invariants passed.

Release-significant failures were reproduced in filtering, mobile interaction, keyboard focus, reader export authorization, select-option validation, row breadcrumbs, canonical database routing and accessibility. Admin-only document-field, row ACL, template restriction, cross-space copy and cleanup scenarios remain `BLOCKED` because the retained writer account cannot manage the space and the admin storage state was not available.

## Remediation status — 2026-08-07

The failures below were corrected in the working tree after this historical run. `http://localhost:3000` still serves the previously recorded container image, so server fixes and the production bundle require an explicit rebuild/restart before the original target can be rerun. Client UI verification used a temporary Vite runtime at `http://localhost:5173` with the same backend and retained writer fixture.

| Original defect | Remediation | Verification | Status |
|---|---|---|---|
| reader export returns 200 | non-admin export now requires `Manage Page`; readable Markdown endpoint remains `Read Page` | service regression test rejects reader and allows writer; server build/lint pass | FIXED_SOURCE / PENDING_DEPLOY |
| select/user/page-reference display filters | paginated SQL resolves select labels, member names and page titles with stored-ID fallback; the same comparable is used for property sort | SQL compilation tests for all three types; 61 focused server tests pass | FIXED_SOURCE / PENDING_DEPLOY_E2E |
| forward Tab loses focus | active cell receives an explicit DOM key and the next editor is focused after state transition; Enter/F2 starts keyboard editing | Playwright: `Code textarea -> Tab -> Approved checkbox -> Shift+Tab -> Code textarea` | PASS_DEV_UI |
| mobile sidebar/Drawer/sticky Title/targets | route navigation closes the sidebar; Drawer is 85dvh with scrollable body; Title is non-sticky; database action controls use 32px targets | Playwright at 412×915: sidebar `aria-hidden=true` + `inert`, Title `position: static`, targets 32×32, all Drawer controls visible; `fix-mobile-view-drawer-20260807.png` | PASS_DEV_UI |
| direct touch column reorder | touch/pen Pointer Events now drive the existing property reorder pipeline; keyboard/menu fallbacks remain | source/build/lint pass; the in-app browser does not support CDP touch dispatch, so a post-deploy device gesture rerun is still required | FIXED_SOURCE / PENDING_TOUCH_E2E |
| duplicate select values accepted | DTO settings use `ArrayUnique(option.value)` for create/update | create/update DTO regression tests pass | FIXED_SOURCE / PENDING_DEPLOY |
| row parent missing from breadcrumbs | breadcrumb UI consumes the authorized server path, enriches only matching sidebar nodes and normalizes parent order; server CTE now orders by depth | Playwright shows `Desktop Matrix -> row -> child`; `fix-row-child-breadcrumb-20260807.png`; utility tests cover unrelated-node exclusion and unordered paths | PASS_DEV_UI |
| canonical database context can lose ID | database route can recover `databaseId` from nested sidebar metadata while the page query is resolving | unit test plus canonical database URL smoke on Vite runtime | PASS_DEV_UI |
| database accessibility findings | multiline/code/user editors now have cell-specific names; database icon targets use the shared 32px control | scoped axe: zero serious/critical violations for desktop table and mobile View Drawer | PASS_DEV_UI_SCOPE |

The original matrix below remains the evidence for the immutable container run. It must not be read as a post-remediation rerun.

## Device matrix

`PASS` means a browser assertion exists. `FAIL` means the browser or API evidence reproduced a product defect. `BLOCKED` means the required authority or reachable UI state was unavailable. `UNSUPPORTED` means the current product has no such capability.

| Scenario | Desktop | Tablet | Touch/mobile | Evidence |
|---|---|---|---|---|
| create database | PASS | PASS | PASS | `03-*-property-matrix.png` |
| create all six property types | PASS | PASS | PASS | `03-*-property-matrix.png`, `interaction-*.json` |
| create/edit/delete row | PASS | PASS | PASS | `interaction-*.json`, `bulk-*.json` |
| basic mouse/touch editing, blur/save, Escape | PASS | PASS | PASS | `interaction-*.json`; mobile required horizontal positioning |
| Enter/Shift+Enter/Tab/Shift+Tab | FAIL | FAIL | FAIL | multiline/code Shift+Enter and Shift+Tab pass; forward Tab saves but DOM focus does not advance (`04-desktop-keyboard-focus-defect.png`) |
| reorder columns: keyboard/menu + reload | PASS | PASS | PASS | `reorder-*.json`, SQL positions |
| direct pointer/touch drag reorder | PASS | PASS | FAIL | mobile gesture did not reorder (`15-mobile-touch-reorder-fail.png`) |
| text/checkbox filters, escaping, NOT_EQUALS, two-condition AND | PASS | PASS | BLOCKED | `view-state-*.json`; mobile Drawer controls become unreachable |
| displayed select/user/page-reference filter values | FAIL | FAIL | BLOCKED | label/name/title queries return no rows; paginated server path compares stored IDs/values |
| sort asc/desc and numeric-looking/case variants | PASS | PASS | BLOCKED | `view-state-*.json`; mobile Drawer limitation |
| filter/sort persistence after reload | PASS | PASS | BLOCKED | same-context localStorage pass; desktop fresh context is isolated |
| column order persistence after reload/new context | PASS | PASS | PASS | `reorder-*.json`, `sql-invariants.json` |
| rename select option and preserve stored value | PASS | PASS | PASS | `select-option-*.json` |
| reject duplicate select option values | FAIL | FAIL | FAIL | server accepted duplicate values with HTTP 200; negative request executed once against shared contract |
| rename status groups | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | status enum/groups are fixed; no settings UI |
| bulk select/update/delete/Undo | PASS | PASS | PASS | `bulk-*.json` |
| client bulk chunking / server maximum | PASS | PASS | PASS | 36 rows split `[25,11]`; 201-row and 201-cell requests returned 400 |
| bulk partial failure on ACL-denied row | BLOCKED | BLOCKED | BLOCKED | row ACL could not be configured without admin |
| row detail, title/content persistence, subpage creation | PASS | PASS | PASS | `row-detail-*.json`, `17-*-row-detail-child.png` |
| row-child breadcrumb | FAIL | FAIL | FAIL | parent breadcrumb absent (`18-*-child-breadcrumb.png`) |
| page → database → page → database | PASS | PASS | BLOCKED | IDs/properties/rows/cells restored on desktop/tablet; mobile target cell remains under sticky Title column |
| template/embed conversion restrictions | BLOCKED | BLOCKED | BLOCKED | writer cannot mark template (403); no admin state |
| duplicate row in same space | PASS | PASS | PASS | `duplicate-attachments.json`, `duplicate-{tablet,mobile}.json` |
| duplicate database with attachment ID/hash verification | PASS | BLOCKED | BLOCKED | desktop IDs differ and SHA-256 hashes match; touch projects only ran row-duplicate smoke |
| copy to another space | BLOCKED | BLOCKED | BLOCKED | no isolated writable target space; unrelated spaces were not mutated |
| history UI, readable values, eventVersion 1 | PASS | PASS | PASS | `history-*.json`, `22-*-history-events.png`, SQL event summary |
| hidden document fields | PASS | PASS | PASS | all fields hidden when space setting is null (`document-fields-hidden-*.json`) |
| configure field visibility/status/assignee/stakeholders | BLOCKED | BLOCKED | BLOCKED | writer has no Space settings; direct PATCH returned 403 |
| AI role values | BLOCKED | BLOCKED | BLOCKED | UI round-trip requires admin; enum/unit coverage passed |
| reading time boundaries/live update | BLOCKED | BLOCKED | BLOCKED | UI visibility requires admin; focused unit tests passed; SQL confirms no persisted key |
| same-cell/different-cell/Yjs/reorder/move concurrency | PASS | BLOCKED | BLOCKED | two independent desktop writer contexts + reader; both writers share one identity |
| viewer/read-only | PASS | PASS | PASS | reads 200, mutation 403, edit/bulk controls absent (`readonly-*.json`) |
| row-page ACL pruning | BLOCKED | BLOCKED | BLOCKED | writer cannot open Access; fixture exists but no deny rule was applied |
| current-view Markdown/HTML/PDF/Docmost export | PASS | PASS | PASS | desktop full validation; tablet/mobile Markdown download smoke |
| reader export authorization | FAIL | FAIL | FAIL | UI hides Export, but direct reader export returned HTTP 200 |
| accessibility serious/critical gate | FAIL | FAIL | FAIL | axe findings in table, row detail/history/read-only states |

## Confirmed product defects

1. **Reader export authorization mismatch.** A reader does not see the Export action, yet a direct export POST succeeds with HTTP 200 (`export-fixture.json`).
2. **Human-readable reference filtering fails.** `select`, `user` and `page_reference` filters using the values shown in the UI return no rows. The paginated path compares option/member/page IDs, while current-view export resolves labels/names/titles (`view-state-*.json`, `inventory.md`).
3. **Forward Tab focus is broken.** The edit is saved, but the browser focus does not advance to the next cell on desktop, tablet or mobile (`interaction-*.json`).
4. **Mobile database controls are obstructed.** The Drawer can intercept creation/navigation, controls become off-screen, direct touch DnD fails, and after conversion the sticky Title column can cover the editable cell (`12-*`, `13-*`, `15-*`, `20-mobile-conversion-cell-unreachable.png`).
5. **Duplicate select values are accepted server-side.** Updating settings with duplicate option values returned HTTP 200 instead of validation failure (`select-option-desktop.json`).
6. **Row subpage breadcrumbs omit the row parent** on all three viewports (`row-detail-*.json`).
7. **Canonical slug route regression.** The original database slug route rendered blank/404 while direct UUID routes worked; converted database slugs later resolved. UUID navigation was used to continue the matrix.
8. **Accessibility gate fails.** Reproduced serious/critical findings include `aria-input-field-name`, `aria-prohibited-attr`, `aria-hidden-focus`, `button-name`, `color-contrast` and undersized targets. Requested serious/critical policy therefore marks affected scenarios failed.

## Export and PDF evidence

- Markdown, HTML and PDF current-view requests carried the active filter, descending sort and one visible property. Their archives contain exactly the included row and included descendant; the excluded row and its subtree are absent.
- The Docmost archive intentionally omitted `currentView` and contains the full database tree, including the row excluded from the presentation formats.
- The Markdown table order is `Title | Roundtrip Notes desktop`.
- The PDF archive contains three one-page A4 PDFs. Text/table extraction passed. All rendered PNGs were visually inspected: no clipping or overlap was observed, Unicode/text order is intact, and the root table uses the requested column order. See `pdf-inspection.json` and `pdf-rendering/`.

## Concurrency result

Two isolated writer browser contexts and one reader context were synchronized with a start barrier. The controlled same-cell sequence converged to the second value; the simultaneous race accepted either winner and converged to one value after reload. Parallel different-cell edits and both Yjs fragments were preserved. Concurrent reorder finished with one unique contiguous permutation. Concurrent moves finished with one parent and SQL found no cycles or orphans. Reader mutation returned 403 while live updates remained visible.

Limitation: the two writer contexts use the same writer user ID because admin storage state was unavailable. Therefore this validates independent sessions/clients, not two distinct writer identities. Full details are in `concurrency-results.md`.

## SQL invariants

The final SQL phase used one `BEGIN TRANSACTION READ ONLY` transaction followed by `ROLLBACK`; SQL did not replace browser assertions. Zero violations were found for duplicate active database roots, duplicate active rows/cells, cross-database cell links, row-parent mismatches, non-contiguous property positions, cycles, unreachable active pages and persisted `readingTime` keys. Attachment IDs are distinct and all copied files are 77-byte `text/plain` rows. See `sql-invariants.md` and `sql-invariants.json`.

## Runtime phases and reproducibility

The test target changed externally during execution. Results are tied to the runtime phase in which they were captured, not assumed to describe an immutable build. The final healthy container uses image `sha256:c9f5…` while the final Git HEAD is `db3abf1b…`; no automatic rebuild was initiated by this test run. The `d12ae528… → db3abf1b…` diff contains no database client/server/migration/API-contract files. See `runtime-phases.md`.

## Cleanup and retained secrets

Cleanup is **BLOCKED**. The active QA fixture currently contains one space, 208 pages, 11 databases, 35 properties, 158 rows, 242 cells, 3 space memberships and 8 attachments. The writer cannot delete the space, remove workspace members/invitations, or revoke their sessions. SQL deletion was deliberately not used.

The writer/reader storage states remain only in the isolated harness so cleanup can resume; they must be destroyed immediately after an admin performs product-UI cleanup. Traces are disabled and previously generated trace ZIPs containing cookies were removed. Retained report/output text is checked for JWT, CSRF and password patterns before handoff.

## Required follow-up

Provide a fresh admin browser state/cookies through environment-only input, then run: document-field visibility and value matrices, row ACL pruning/export checks, template/embed conversion negatives, isolated cross-space copy, UI cleanup of the QA space/accounts/invitations/sessions, final read-only zero-count SQL check, and destruction of all auth-state/password files.
