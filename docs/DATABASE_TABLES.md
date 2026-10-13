# Database tables

Database rows remain ordinary pages. Page access rules apply to their contents, cells, history, and derived totals. A database reader never receives rows denied by effective page ACL. Write access is rechecked for each row in a batch.

## Properties and values

Existing types remain supported: `multiline_text`, `code`, `checkbox`, `select`, `user`, and `page_reference`. New types are `number`, `date`, `multi_select`, `url`, `email`, and `phone`.

Numbers are finite JSON numbers; optional settings select number, percent, or currency formatting and 0-10 decimal places. Formatting does not change the stored value. Dates are `{start, end?, timeZone?}`. Calendar-only values use `YYYY-MM-DD` without a time-zone conversion. Timed values use ISO instants and require an IANA time zone. End values cannot precede start values. Multi-select values are unique option identifiers; options use the existing label/value/color contract. New URL values permit only HTTP and HTTPS; email and phone fields open the appropriate device handler.

The server validates new writes using the actual active property type and settings. Legacy stored representations remain readable. Type conversion preserves the existing fallback container for values that cannot be converted. Conversion and property metadata changes commit in one transaction with database-scoped mutation locking.

## Views and queries

Version 2 view state contains `filter`, `sorts`, `groupBy`, `visibleColumns`, and `calculations`. Legacy `filters` and `sortState` configurations are adapted on read. Filters support AND/OR, at most two group levels and ten rules. Sorts contain at most five keys; `title` is a built-in field. Numeric values sort numerically, date values chronologically. Position and page ID provide stable pagination tie-breakers.

`GET /api/databases/:databaseId/rows` accepts a JSON `viewState`, optional opaque `groupKey`, and the existing pagination parameters. `GET /api/databases/:databaseId/summary` returns global row count, requested calculations, and group counts/calculations over the complete filtered accessible selection. The same compiler supplies table queries and version 2 exports. It does not load all rows into the browser.

Grouping supports one select, multi-select, checkbox, or user property. The table offers group navigation and an all-rows view. Empty values have their own group. Multi-select rows may occur in several groups, while global totals count each page once. Calculations include count, filled/empty values, numeric sum/average/min/max, and earliest/latest date.

Existing shared views autosave after 500 ms. Creating a new view remains explicit. Readers may adjust their local view but cannot persist shared changes. A stale revision returns HTTP 409 and preserves the draft; users can load the latest settings or explicitly apply their changes against the latest revision.

## Mutation and recovery

Cells and views carry integer revisions. A new client sends `expectedRevision`; a missing active cell uses revision 0. Legacy callers may omit the revision. Batches are atomic per row and return `updatedRows`, `deletedRows`, `failedRows`, and optional failure codes. Successful rows are not resent when retrying partial failures. A conflict is never silently rebased onto another user's value.

TSV insertion preserves internal empty rows and cells. An oversized area is rejected before mutation and asks the user to load additional rows or reduce the area. It does not create rows automatically. Pending deletion retains the original database and its six-second undo window across component unmounts.

Assignment notification dispatch is recorded in the existing transactional outbox. A failed cell transaction creates neither persisted values nor notification work. Migration `20261013T120000-database-revisions.ts` adds revision metadata and a read-only SQL value adapter without rewriting values. Apply it before running the updated server. Its rollback removes the adapter and revision metadata, not the new property values; an older application is therefore not a compatible downgrade after using new types.

RAG and AI projection boundaries remain independent of view filters. See [AI and RAG](AI_ASSISTANT_AND_RAG.md#database-table-property-contract).

## Verification

- Unit regressions: `corepack pnpm --filter ./apps/client exec vitest run src/features/database` and the server database suites.
- PostgreSQL: set `DATABASE_TABLES_TEST_DATABASE_URL` to an isolated localhost database ending in `_test`, then run `corepack pnpm --filter ./apps/server exec jest --config test/jest-e2e.json --runInBand test/database-tables.e2e-spec.ts`. The suite owns a unique schema and does not load application environment files.
- Browser: `node apps/client/e2e/database/run.mjs` owns Vite on localhost port 5195. It mounts the production table component with a synthetic API; this confirms browser behavior, while the separate PostgreSQL suite verifies backend transactions and query semantics.
- Full local application: build the monorepo, then run `node apps/client/e2e/database/run-live.mjs`. The runner creates dedicated localhost PostgreSQL 18 and Redis 8 containers, applies all migrations, starts the built API and collaboration process, and serves the production client. It seeds 1,000 rows and 20 fields with actual editor/reader sessions and mixed row ACL, runs the PostgreSQL regressions, HTTP/export/import/outbox checks, and the light/dark browser matrix at 320/390/768/1440 px. Application secrets and authentication cookies stay in memory; traces and videos are disabled. A separate working directory prevents loading the repository `.env` and isolates file storage. Cleanup removes only the runner's own processes, containers, network, and runtime files. Compact receipts are saved under `artifacts/database/live/<timestamp>/`. `--api-only` and `--startup-only` are diagnostic subsets; Playwright flags such as `--grep` select browser scenarios and are not full acceptance.
- Required broad verification: `corepack pnpm verify:full`, route inventory, AI/fork documentation, and English comment checks.

The synthetic browser fixture is test-only and is not reachable from the production application entry point. Its API stores synthetic records in memory. The live runner instead exercises the actual local application, its PostgreSQL transactions, and Redis workers.
