# Database tables

Database rows remain ordinary pages. Page access rules apply to their contents, cells, history, and derived totals. A database reader never receives rows denied by effective page ACL. Write access is rechecked for each row in a batch.

## Properties and values

Existing types remain supported: `multiline_text`, `code`, `checkbox`, `select`, `user`, and `page_reference`. New types are `number`, `date`, `multi_select`, `url`, `email`, and `phone`.

Numbers are finite JSON numbers; optional settings select number, percent, or currency formatting and 0-10 decimal places. Formatting does not change the stored value. Dates are `{start, end?, timeZone?}`. Calendar-only values use `YYYY-MM-DD` without a time-zone conversion. Timed values use ISO instants and require an IANA time zone. End values cannot precede start values. Multi-select values are unique option identifiers; options use the existing label/value/color contract. New URL values permit only HTTP and HTTPS; email and phone fields open the appropriate device handler.

The server validates new writes using the actual active property type and settings. Legacy stored representations remain readable. Type conversion preserves the existing fallback container for values that cannot be converted. Conversion and property metadata changes commit in one transaction with database-scoped mutation locking.

## Views and queries

Version 2 view state contains `filter`, `sorts`, `groupBy`, `visibleColumns`, and `calculations`. Legacy `filters` and `sortState` configurations are adapted on read. Filters support AND/OR, at most two group levels and ten rules. Sorts contain at most five keys; `title` is a built-in field. Numeric values sort numerically, date values chronologically. Position and page ID provide stable pagination tie-breakers.

`GET /api/databases/:databaseId/rows` accepts a JSON `viewState`, optional opaque `groupKey`, and the existing pagination parameters. `GET /api/databases/:databaseId/summary` returns global row count, requested calculations, and group counts/calculations over the complete filtered accessible selection. The same compiler supplies table, Kanban, AI, and view-export queries. It does not load all rows into the browser.

Grouping supports one select, multi-select, checkbox, or user property. The table offers group navigation and an all-rows view. Empty values have their own group. Multi-select rows may occur in several groups, while global totals count each page once. Calculations include count, filled/empty values, numeric sum/average/min/max, and earliest/latest date.

View changes remain personal drafts until an editor selects Save for everyone. Drafts are stored separately for each user/database/view in this browser. Creating a new view remains explicit. Readers may adjust local filters and sorts without persisting shared changes. A stale revision returns HTTP 409 and preserves the draft; users can load the latest settings or explicitly apply their changes against the latest revision.

## Kanban, record preview, and linked views

Kanban groups by one single-select property, including a separate empty-value
column. Each column has its own 30-row cursor and full server-side count. Column
order/visibility and card fields belong to the view. Native drag and drop and an
accessible move selector update the group cell through the ordinary cell API
with its expected revision. A conflicting move reloads authoritative data.

Without a sort, a saved view supports manual card order through
`POST /api/databases/:databaseId/views/:viewId/rows/actions/move`. It checks the
view revision, current row position, root write access and row access. Position
keys live in `database_view_row_positions`; they never change page-tree order.
Explicit sorts disable manual order. View queries accept `viewId` to preserve
that order in tables, Kanban, AI and CSV.

Format 3 adds `columnOrder`, `columnWidths` and `kanban` settings. Format 2 and
legacy views remain readable. Both service validation and the atomic update
predicate reject an older format overwriting a format 3 view. The archive stores
optional per-view row positions and remaps property/page/view identities on
import. Existing database, property and row-page identifiers are preserved in
ordinary use. Migration `20261030T190000-database-view-row-order.ts` adds only
view ordering data. Its down loses that preference; it does not delete cells.
An application downgrade also needs an explicit decision about format 3 layouts.

A row opens in a URL-addressable side panel without unmounting the table. It
reuses document property editors, the read-only page renderer, comments and
history. Content editing and history restoration use the full page. Previous
and next query neighbors across the full filtered, sorted and accessible selection; a direct `record` URL loads its page
independently. Table scroll, selection and the local view survive closing it.

The `databaseEmbed` atom links an existing database and optional saved view.
The source is fetched under its own ACL; container write access does not grant
source write access. A slash command and an internal-database-link paste choice
create the block. Removing the atom removes only the link. Public shares render
an unavailable placeholder and make no authenticated source request. Markdown,
HTML and PDF preparation materialize permitted views as tables, up to 10000
rows; larger snapshots fail explicitly. A portable archive keeps links to bases
included in the archive and snapshots other permitted sources. RAG text
projection does not expand linked blocks, so one source is not indexed again
through each embedding.

CSV exports all matching readable rows and visible properties in view order,
with quoted multiline values and neutralized spreadsheet instructions. A
Docmost archive always exports the full accessible database and ignores the
current UI filter. CSV contains values and titles; it excludes row contents and
attachments.

## Mutation and recovery

Cells and views carry integer revisions. A new client sends `expectedRevision`; a missing active cell uses revision 0. Legacy callers may omit the revision. Batches are atomic per row and return `updatedRows`, `deletedRows`, `failedRows`, and optional failure codes. Successful rows are not resent when retrying partial failures. A conflict is never silently rebased onto another user's value.

TSV insertion preserves internal empty rows and cells. An oversized area is rejected before mutation and asks the user to load additional rows or reduce the area. It does not create rows automatically. Pending deletion retains the original database and its six-second undo window across component unmounts.

Assignment notification dispatch is recorded in the existing transactional outbox. A failed cell transaction creates neither persisted values nor notification work. Migration `20261013T120000-database-revisions.ts` adds revision metadata and a read-only SQL value adapter without rewriting values. Apply it before running the updated server. Its rollback removes the adapter and revision metadata, not the new property values; an older application is therefore not a compatible downgrade after using new types.

RAG and AI projection boundaries remain independent of view filters. See [AI and RAG](AI_ASSISTANT_AND_RAG.md#database-table-property-contract).

## AI view queries and cell approvals

The table publishes its live view state and explicit selection to the assistant.
Sending a message freezes that state, including the focused group and normalized
local filter values, for the attempt. Agent tools use the same
SQL compiler as the table, with AI content exclusions applied in addition to
page ACL. Only internal Agent mode may propose existing-cell changes; the user
must approve a complete revision-bound preview. See
[AI database approvals](AI_ASSISTANT_AND_RAG.md#database-views-and-approved-cell-changes)
for limits, policy controls, transaction recovery and MCP boundaries.

## Verification commands

- Unit regressions: `corepack pnpm --filter ./apps/client exec vitest run src/features/database` and the server database suites.
- PostgreSQL: set `DATABASE_TABLES_TEST_DATABASE_URL` to an isolated localhost database ending in `_test`, then run `corepack pnpm --filter ./apps/server exec jest --config test/jest-e2e.json --runInBand test/database-tables.e2e-spec.ts`. The suite owns a unique schema and does not load application environment files.
- Browser: `node apps/client/e2e/database/run.mjs` owns Vite on localhost port 5195. It mounts the production table component with a synthetic API; this confirms browser behavior, while the separate PostgreSQL suite verifies backend transactions and query semantics.
- Full local application: build the monorepo, then run `node apps/client/e2e/database/run-live.mjs`. The runner creates dedicated localhost PostgreSQL 18 and Redis 8 containers, applies all migrations, starts the built API and collaboration process, and serves the production client. It seeds 1,000 rows and 20 fields with actual editor/reader sessions and mixed row ACL, runs the PostgreSQL regressions, HTTP/export/import/outbox checks, and the light/dark browser matrix at 320/390/768/1440 px. Application secrets and authentication cookies stay in memory; traces and videos are disabled. A separate working directory prevents loading the repository `.env` and isolates file storage. Cleanup removes only the runner's own processes, containers, network, and runtime files. Compact receipts are saved under `artifacts/database/live/<timestamp>/`. `--api-only` and `--startup-only` are diagnostic subsets; Playwright flags such as `--grep` select browser scenarios and are not full acceptance.

The live runner also accepts `--subnet=10.x.x.0/28` for an unused private
Docker subnet when the daemon's default address pools are exhausted. Check
existing network ranges before choosing it. The argument is consumed by the
runner and is not forwarded to Playwright.
- Required broad verification: `corepack pnpm verify:full`, route inventory, AI/fork documentation, and English comment checks.

The synthetic browser fixture is test-only and is not reachable from the production application entry point. Its API stores synthetic records in memory. The live runner instead exercises the actual local application, its PostgreSQL transactions, and Redis workers.
