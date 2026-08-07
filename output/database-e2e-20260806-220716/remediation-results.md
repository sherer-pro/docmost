# Database remediation results

Date: `2026-08-07`
Source baseline: `db3abf1bd190130d061005c08b2343c018dec47a` plus uncommitted remediation changes
Historical runtime: `http://localhost:3000` (old container bundle)
UI verification runtime: `http://localhost:5173` (temporary Vite client, same backend/fixtures)

## Implemented

- Export is denied to users without `Manage Page`; read-only database Markdown remains readable.
- Paginated filters and property sorts resolve displayed `select`, `user` and `page_reference` values.
- Duplicate select option values fail DTO validation on create and update.
- Tab/Shift+Tab focus follows the active database editor; Enter/F2 starts editing from a focused cell.
- Touch/pen column handles use Pointer Events and retain keyboard/menu alternatives.
- Mobile navigation closes the sidebar on route change, View Drawer is bounded/scrollable, and Title no longer overlays editable columns.
- Database cell editors have cell-specific accessible names; database action controls have 32px minimum targets.
- Breadcrumbs use the server ancestor chain, exclude unrelated sidebar nodes, normalize root-to-child order, and the server query orders the recursive result explicitly.
- Database page context can recover the database ID from canonical sidebar route metadata.

## Automated verification

- Server Jest: `61 passed` (`database.dto`, `database-row.repo`, `database.service`).
- Client Vitest: `17 passed` after final breadcrumb changes; earlier helper run added 10 unchanged helper tests.
- Targeted ESLint: pass for all changed server/client TypeScript files.
- Server production build: pass.
- Client production build: pass (only the existing Rollup chunk-size warning).
- `git diff --check`: pass before report generation; final check is recorded in the task handoff.

## Playwright evidence

- Desktop Tab: active element moved from `Code` textarea to `Approved` checkbox.
- Desktop Shift+Tab: active element returned to the `Code` textarea.
- Desktop row-child breadcrumb: `Desktop Matrix -> desktop interaction ... -> Child desktop ...`.
- Mobile 412×915: sidebar has `aria-hidden=true` and `inert`; Title uses `position: static`; sampled Move/Property action controls are 32×32.
- Mobile View Drawer: 85dvh content, scrollable body, `Reset` remains inside the viewport.
- Scoped axe serious/critical results: `[]` for the desktop database table and `[]` for the mobile View Drawer.

Screenshots:

- `screenshots/fix-mobile-view-drawer-20260807.png`
- `screenshots/fix-row-child-breadcrumb-20260807.png`

## Remaining verification

- Rebuild/restart the `localhost:3000` container, then rerun reader export and displayed-value filter/sort E2E against the deployed server.
- Repeat direct touch drag-and-drop on a real touch-capable Playwright project; the in-app browser backend cannot dispatch CDP touch input.
- Rerun the full-page axe gate. The scoped database table/Drawer pass does not close unrelated historical `aria-hidden-focus`, `button-name` or color-contrast findings outside these components.
- Admin-only document fields, row ACL, template/embed negatives, cleanup and final zero-count SQL remain blocked exactly as recorded in the historical report.
