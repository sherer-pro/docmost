# Database tables

Database rows remain ordinary pages. Page access rules apply to their contents, cells, history, and derived totals. A database reader never receives rows denied by effective page ACL. Write access is rechecked for each row in a batch.

## Properties and values

Existing types remain supported: `multiline_text`, `code`, `checkbox`, `select`, `user`, and `page_reference`. New types are `number`, `date`, `multi_select`, `url`, `email`, and `phone`.

Numbers are finite JSON numbers; optional settings select number, percent, or currency formatting and 0-10 decimal places. Formatting does not change the stored value. Dates are `{start, end?, timeZone?}`. Calendar-only values use `YYYY-MM-DD` without a time-zone conversion. Timed values use ISO instants and require an IANA time zone. End values cannot precede start values. Multi-select values are unique option identifiers; options use the existing label/value/color contract. New URL values permit only HTTP and HTTPS; email and phone fields open the appropriate device handler.

The server validates new writes using the actual active property type and settings. Legacy stored representations remain readable. Type conversion preserves the existing fallback container for values that cannot be converted. Conversion and property metadata changes commit in one transaction with database-scoped mutation locking.

### System fields, participants, files and formulas

`created_at`, `updated_at` and `updated_by` are computed, read-only properties.
Created time comes from the row page. Modified time and actor follow the latest
page or row mutation. Cell writes and type conversions update row mutation
metadata in their transaction; computed cells are never stored in `database_cells`.

The title column remains pinned. Narrow layouts constrain its width, place row
actions below the title, and reserve scroll padding for the pinned columns so
property controls remain reachable at 320 and 390 px.

User values retain compatible reading of a single ID or `{id}`. New multiple
values are sorted, unique arrays of `{id}`, with at most 20 participants. New
assignments require active, assignable space members. Every newly assigned user
other than the actor receives the existing transactional notification. Membership
filters match any selected ID; `not_equals` matches none. A row may belong to
several participant groups while the global count includes it once.

File properties store up to 20 `{attachmentId}` references. Attachments must be
active and owned by the row page in the same workspace. Displayed names, MIME
types and sizes come from the server. Readers can download; writers can select
existing row attachments or upload through the normal attachment API. Removing a
cell value retains the file in the page gallery. References in cell history
`change_data` also block unused-file removal. File-property row history commits
with the cell mutation rather than waiting for history aggregation; its failure
rolls the mutation back. Failed uploads remain ordinary
page attachments for the existing cleanup workflow; cell saves retain revision
checks and row atomicity.

Formulas use `{languageVersion: 1, expression, resultType}`. Supported results
are number, text, date and checkbox. `prop("property-uuid")` stores a stable
dependency; `prop("title")` reads the record title. The closed function set is
`add`, `subtract`, `multiply`, `divide`, `if`, `eq`, `gt`, `and`, `or`, `not`,
`concat`, `text`, `length`, `trim`, `slice`, `date`, `dateAdd` and `dateDiff`.
There is no JavaScript, `eval`, SQL input, clock or network access. User, page,
file and multi-select dependencies are excluded. A select dependency returns its
option ID. Rename preserves dependencies; deletion or a type change is rejected
while a dependent formula would become invalid. Cycles and incompatible result
types are rejected before schema changes commit.

Expressions are limited to 4096 characters, 1024 characters per literal,
128 syntax nodes, depth 16, 16 formula properties and 400 expanded nodes per
formula. SQL compilation additionally bounds lateral expressions to 512 nodes.
Numbers and arithmetic results have absolute value at most `1e15`; text results
are limited to 16 KiB. `slice(text, offset, length)` uses nonnegative Unicode
character offsets/lengths up to 16384. Date arithmetic uses calendar days in the
source field time zone, dates from year 0001 through 9999 and integer day shifts
up to 366000. Empty arithmetic operands return empty results; `text(null)` is
empty text, `eq(null, null)` is true and an empty `if` condition selects its else
branch. Runtime failures are typed `{error}` cell values. Aggregates exclude
failed numeric/date values and report per-property error counts; AI marks these
totals incomplete with `formula_errors`.

Table, Kanban, CSV, API/AI queries and RAG projections use the same server value
compiler. Portable archives store schema and manual values, then recompute system
and formula cells after import. Import and duplication remap formula dependency
tokens and file references; literal text is preserved. Converting to or from a
computed/file property is rejected; create a separate property instead.

New property/cell mutations send `contractVersion: 4`. The server rejects legacy
mutations of computed/file properties or participant arrays, including clearing
an existing array. Existing single-user and other legacy writes remain supported.
Migration `20261031T130000-database-computed-and-file-properties.ts` expands the
legacy value adapter and backfills row mutation metadata from existing cells. It
does not rewrite values. Its down refuses while new property types or participant
arrays exist and retains the compatible adapter and corrected metadata.

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
reuses document property editors, the collaborative body and title editors,
comments and restorable history. Page ACL and the record's own editing preference
apply independently of the database description. A `jotai-scope` provider isolates
editor, search, comment, history and database-context atoms while sharing user,
session and query state. Find and comment events carry their owning editor or
page ID; changing the record title does not navigate the database URL. Previous
and next query neighbors across the full filtered, sorted and accessible selection; a direct `record` URL loads its page
independently. Table scroll, selection and the local view survive closing it.

The pinned React Router patch memoizes Link's combined DOM ref. A query-only
navigation otherwise detaches stateful Floating UI references and can enter a
React update loop while opening the panel. The native ref regression and the
live panel matrix cover this interaction without changing the router version.
An independent Mantine patch preserves SegmentedControl and ScrollArea
root/scrollbar refs during updates. Recreating the internal scrollbar callback
can repeatedly detach the same DOM element and trigger a state update loop.
All native dependency regressions and the combined browser matrix must pass
before either patch is removed.

Local document-content cache updates give the UUID and slug aliases the same
snapshot, including the same `Date` instance. Separate equal-looking timestamps
can otherwise keep alias subscriptions exchanging objects during collaborative
editor initialization. The cache helper also rejects a mismatched page ID.

The compact toolbar groups view selection, layout, shared save and view settings.
Property creation opens separately; view names and deletion live in settings.
Readers can use personal filters and choose whether to pin the toolbar; the
preference is local to the user and database. Embedded toolbars are not sticky.
Long descriptions collapse in reading mode while their editor remains mounted.
Editing and a revealed search match expand the description.

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
- PostgreSQL diagnostic with managed local services: `node apps/client/e2e/database/run-live.mjs --postgres-only` runs only that suite against its own containers. It does not establish HTTP or browser acceptance.
- Advanced value diagnostic: build first, then run `node apps/client/e2e/database/run-live.mjs --advanced-only --api-only` for live values, CSV, history retention, import and duplication. Remove `--api-only` and add `--grep="live advanced database" --browser=all` for the desktop/light and mobile/dark browser matrix. A full default run includes these scenarios.
- `--browser=all` runs Chromium, Firefox and WebKit sequentially with a fresh isolated application and database for each browser. PostgreSQL, HTTP and browser assertions run unchanged; a failed browser does not seed or prevent the other browser runs. API-only, startup-only, PostgreSQL-only and model-quality diagnostics start a single runtime.
- Service Workers stay enabled for ordinary browser scenarios. Only the four
  scenarios that inject network faults block them in their isolated browser
  context, because a worker-controlled request bypasses Playwright routing.
  The mutation-error case records its injection count; a missing injected fault
  cannot be mistaken for product recovery. Synthetic paste explicitly supplies
  its clipboard payload because Firefox strips constructor-provided data from
  untrusted `ClipboardEvent` instances.
- Every browser scenario resets only the shared synthetic user's `aiPanelOpen`
  preference before navigation. AI scenarios can open it normally. This prevents
  a previous result-link case from covering subsequent mobile controls with a
  persisted drawer; timeout and pointer-interception assertions stay unchanged.
- Keyboard-editing acceptance selects a cell fully inside the scroll viewport;
  the first rendered virtual row can be overscan above it. Both starting the
  edit and saving it must preserve scroll. Footnote creation explicitly moves
  the native caret to the document end before opening the slash command.
- Browser: `node apps/client/e2e/database/run.mjs` owns Vite on localhost port 5195. It mounts the production table component with a synthetic API; this confirms browser behavior, while the separate PostgreSQL suite verifies backend transactions and query semantics.
- Full local application: build the monorepo, then run `node apps/client/e2e/database/run-live.mjs`. The runner creates dedicated localhost PostgreSQL 18 and Redis 8 containers, applies all migrations, starts the built API and collaboration process, and serves the production client. It seeds 1,000 rows and 20 fields with actual editor/reader sessions and mixed row ACL, runs the PostgreSQL regressions, HTTP/export/import/outbox checks, and the light/dark browser matrix at 320/390/768/1440 px. Application secrets and authentication cookies stay in memory; traces and videos are disabled. A separate working directory prevents loading the repository `.env` and isolates file storage. Cleanup removes only the runner's own processes, containers, network, and runtime files. Compact receipts are saved under `artifacts/database/live/<timestamp>/`. `--api-only` and `--startup-only` are diagnostic subsets; Playwright flags such as `--grep` select browser scenarios and are not full acceptance.

The live runner also accepts `--subnet=10.x.x.0/28` for an unused private
Docker subnet when the daemon's default address pools are exhausted. Check
existing network ranges before choosing it. The argument is consumed by the
runner and is not forwarded to Playwright.
It copies the built API, collaboration and frontend into its own runtime before
starting them. Later repository builds cannot replace assets served by an active
acceptance run. Dependencies are linked from the installed workspace; no package
installation or environment file is copied into the snapshot.
- Required broad verification: `corepack pnpm verify:full`, route inventory, AI/fork documentation, and English comment checks.

For the complete release gate, use Node 22 and an installed Corepack on `PATH`,
build first, then run `node apps/client/e2e/database/run-live.mjs --release`.
An optional verified-unused `--subnet=10.x.x.0/28` has the same meaning as above;
other diagnostic/browser flags are rejected. This mode runs the PostgreSQL
acceptance, copies shared package artifacts into the immutable runtime, creates
a synthetic administrator, and executes the unmodified `corepack pnpm verify:release`
command. It supplies only the owned API/collaboration URLs, in-memory cookies and
local mock provider/retrieval origins. The full editor export verifier remains
enabled. Each browser audit writes into that run's own `release/` directory;
`verify-release.log` is scrubbed before it is saved or printed. The nested Agent
audit uses its own Compose project and an empty explicit environment file, so
Compose cannot load the repository `.env`. No existing runtime or user account is
used. Runtime cleanup follows the same ownership checks as ordinary acceptance.
Docker build contexts exclude private QA artifacts and machine-local `.codex`
configuration; a linked verification checkout must not place its local MCP
configuration into an application image.
If Docker's automatic address pools are exhausted, the nested Agent audit also
accepts `DOCMOST_AI_AGENT_DEFAULT_SUBNET` and `DOCMOST_AI_AGENT_EDGE_SUBNET`.
Supply both as distinct, verified-unused canonical private `10.x.x.0/28` ranges;
the release helper forwards only these two test settings. The Agent runner
validates them before starting processes and writes an owned Compose network
override. Its ordinary project cleanup removes these test networks. Empty
settings retain Docker's normal automatic allocation; daemon pools and existing
networks are never modified.

The synthetic browser fixture is test-only and is not reachable from the production application entry point. Its API stores synthetic records in memory. The live runner instead exercises the actual local application, its PostgreSQL transactions, and Redis workers.
