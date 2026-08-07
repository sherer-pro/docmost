# Database/property contract inventory

Run: `20260806-220716`
Final observed revision: `db3abf1bd190130d061005c08b2343c018dec47a` (no database-module diff from the last browser-tested `d12ae528…` tree)
Evidence levels: **UI** = Playwright browser assertion; **SQL** = read-only invariant; **CODE** = source/history/blame; **UNIT** = focused test; **BLOCKED** = authority or reachable UI unavailable.

Post-run remediation (`2026-08-07`): the working tree now resolves paginated `select` values to option labels, `user` values to member names, and `page_reference` values to page titles, with stored values/IDs as fallback. Duplicate select values are rejected by DTO validation and non-admin export requires `Manage Page`. These source changes pass focused tests/builds but are not present in the historical `localhost:3000` container; see `remediation-results.md`.

## Property types and operators

The API contract exposes exactly six database property types. Every type accepts `contains`, `equals` and `not_equals`; there is no `is_empty`/`is_not_empty` operator.

| Type | Editor / stored value | Clear and missing-cell semantics | Paginated filter/sort comparable | Current-view export comparable | UI result |
|---|---|---|---|---|---|
| `multiline_text` | textarea / string | empty string or clear deletes the cell; missing is `''` | lowercase string | lowercase string | create/edit/Shift+Enter/reload/filter/sort PASS |
| `code` | textarea / string | same | lowercase string | lowercase string | create/edit/Shift+Enter/reload/filter/sort PASS |
| `checkbox` | toggle / boolean | `false` persists and is not null; missing is `''` | `true` / `false` | `true` / `false` | false→true persistence and filters PASS |
| `select` | option `{label,value,color?}`; cell stores option value | clear deletes cell | stored option `value` | option `label`, fallback `value` | edit/rename PASS; label filter FAIL; duplicate value validation FAIL |
| `user` | member reference / member ID | clear deletes cell | member ID | display name, fallback ID | edit/clear PASS; name filter FAIL |
| `page_reference` | page reference / page ID | clear deletes cell | page ID | page title, fallback ID | edit/clear PASS; title filter FAIL |

Operator semantics:

| Operator | Semantics | Missing cell | Result |
|---|---|---|---|
| `contains` | case-insensitive substring | `''` contains only an empty operand; empty filter is ignored | text/code and escaped `%`, `_`, `\` PASS |
| `equals` | case-insensitive exact comparable | missing equals `''`; empty filter is ignored | text/checkbox PASS; displayed select/user/page values FAIL |
| `not_equals` | case-insensitive inequality | missing row is included for any non-empty operand | PASS |

- Multiple non-empty conditions use AND; the two-condition browser scenario passed.
- At most 10 conditions are accepted. Empty `propertyId` or empty value is ignored.
- SQL LIKE literals escape `\`, `%` and `_`.
- `checkbox=false` is distinct from a missing cell.
- UI option creation supports labels/colors and a maximum of 100 options. The server accepted duplicate option `value` entries with HTTP 200, so the client-side uniqueness guard is not an authorization/validation boundary.
- Cell JSON is limited to 20,000 bytes; row/cell batch endpoints accept at most 200 operations; client bulk mutations use sequential chunks of 25; page size is 100 with a server maximum of 200.

## Sort semantics

| Path | Comparable | Tie-break | Browser/export status |
|---|---|---|---|
| paginated table | lowercase text under PostgreSQL C collation | row position, then page ID; direction applies to cursor terms | asc/desc and numeric-looking/case variants PASS on desktop/tablet |
| current-view export | `localeCompare({numeric: true, sensitivity: 'base'})` | row position only | current-view order passed for tested dataset |

The two paths are not contract-equivalent for numeric text, locale variants and exact ties. The browser dataset proves direction changes order, but does not exhaust every cross-page tie permutation; this remains a source-level risk rather than a separately reproduced defect.

## Null and empty matrix

| Input/state | Stored cell | Filter comparable |
|---|---|---|
| text/code `''`, `null`, clear | cell removed | `''` |
| checkbox `false` | active cell with `false` | `false` |
| missing checkbox | no cell | `''`, not `false` |
| select/user/page reference clear | cell removed | `''` |
| empty filter value | no predicate added | condition ignored |

## Bulk actions

| Capability | Contract and result |
|---|---|
| selection | limited to visible/prepared rows; select-all does not include filtered-out rows; UI PASS |
| update | one property across selected rows; UI PASS on all devices |
| chunking | 36 selected rows produced requests `[25, 11]`, both 200 |
| server limit | 201 row operations and 201 cell operations both returned 400 |
| delete/Undo | optimistic delete with 6,000 ms grace; Undo before timeout and final delete after timeout PASS on all devices |
| partial failures | server returns successful and failed rows without rolling successes back; ACL-denied browser reproduction BLOCKED because row ACL could not be configured |

## Permissions

| Actor | Root database | Row page | Controls/API/export |
|---|---|---|---|
| admin/owner | Read + Manage Page | effective page ACL applies | full controls expected; admin-only settings/cleanup not executed because admin state unavailable |
| writer (`Can edit`) | read/manage | read/write/create-child asserted per target | CRUD, bulk, conversion and duplication PASS; Space settings/Access menu denied |
| reader (`Can view`) | read | row detail read | table/row reads 200; mutation 403; edit/bulk controls hidden; direct export unexpectedly 200 (FAIL) |
| ACL-denied row | root may remain readable | explicit row access denies read/write | must be absent from rows/cells/export and direct reads; E2E BLOCKED |

The database API gates both space abilities and page access. Row list endpoints filter through readable-page snapshots. Target operations call page access assertions. UI hiding is not sufficient authorization evidence; the reader export result demonstrates this.

## History events

All structured events are normalized to `eventVersion: 1`. Browser polling and UI summaries passed on all three devices; final SQL saw only version 1 for the tested structured types.

| Area | Types / presentation |
|---|---|
| conversion | `page.converted.to-database`, `database.converted.to-page` |
| properties | `database.property.created`, `.updated`, `.deleted` |
| rows | `database.row.created`, `.renamed`, `.deleted` |
| cells | `database.row.cells.updated`; select/user/page references are enriched for readable values |
| document fields | `page.custom-fields.updated` with status, assignee, stakeholder and AI-role changes |
| AI action | `page.ai-agent.changed`, distinct from manual `aiRole` changes |
| access | `page.access.updated` with principal/effect/role/cascade metadata |
| buffered delivery | database/custom-field changes may be combined as `page.events.combined`; browser polls up to 30 seconds |

The UI showed property names, cell values and conversion summaries. Document-field and ACL-specific history events remain BLOCKED with their admin workflows.

## Conversion constraints and state transitions

- A template, page with incoming embed usages or page with outgoing embed usages cannot be converted; the conflict code is `page_embed_source_in_use` for embed usage.
- Page → database creates or restores metadata and links active descendants as rows.
- Database → page archives database rows/views/properties and soft-deletes database metadata; row pages remain in the tree.
- A later page → database restores the previous database ID, property IDs/settings, rows and cells.
- Desktop and tablet round-trips passed, including a 404 while metadata was archived and restoration of the same database ID/cell after reload.
- Mobile round-trip is BLOCKED at touch cell editing because the sticky Title column covers the target cell.
- Template/embed negative tests are BLOCKED because the writer cannot mark a page as a workspace template and no admin state is available.

## Duplicate/copy and attachments

- Same-space row duplication passed on desktop, tablet and mobile.
- Desktop same-space database duplication copied all six property types and the row set.
- Source, row-copy and database-copy attachment IDs are distinct. Downloaded contents all have SHA-256 `965ed5e7af85a170d3fc45bde5d8a28c323b98db487e070f09a4a3bab6bebe96`; SQL confirms 77-byte `text/plain` rows.
- Duplication remaps page IDs, attachment nodes and internal page references through the copied-page map; attachment work uses the transactional outbox.
- Cross-space copy is BLOCKED because no isolated second writable space was available.

## Export behavior

| Format | Uses current filters/sort/visible properties | Children and ACL | Attachments/result |
|---|---|---|---|
| Markdown | yes | included row descendants kept; excluded row prunes its subtree | ZIP validated; tablet/mobile download smoke PASS |
| HTML | yes | same | ZIP validated |
| PDF | yes | same | three A4 PDFs extracted/rendered; no clipping/overlap observed |
| Docmost | no; full database archive | authorized descendant filtering still applies | full tree and metadata/data included; current-view exclusion intentionally not applied |

The UI sent live filters, sort and visible property IDs. Unknown IDs are rejected by the server contract. The reader UI hides Export, but a direct reader request returned 200: confirmed permissions defect. Row-ACL pruning could not be tested because the deny rule was not configured.

## Views and persistence

- `database_views` and server CRUD exist, but the current table UI does not expose saved-view CRUD.
- Filters and sort persist only in `localStorage` at `docmost:database-table-state:<databaseId>`.
- Same-context reload persistence passed; a fresh desktop context started unfiltered.
- Column order persists server-side through property positions and passed reload/fresh-context/SQL checks.
- Column visibility is component state only and is not persisted.
- Rename status groups and saved-view UI are `UNSUPPORTED`; column visibility persistence is `UNSUPPORTED` in the current implementation.

## Document fields

| Field | Space flag | Page/row payload | Values / derivation | E2E status |
|---|---|---|---|---|
| status | `status` | `status` | `TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`, `REJECTED`, `ARCHIVED` | hidden-state PASS; value matrix BLOCKED |
| assignee | `assignee` | `assigneeId` | one workspace user ID | hidden-state PASS; edit BLOCKED |
| stakeholders | `stakeholders` | `stakeholderIds` | de-duplicated user IDs | hidden-state PASS; edit BLOCKED |
| AI role | `aiRole` | `aiRole` | `NONE`, `EDITOR`, `COAUTHOR`, `COAUTHOR_PLUS`, `AUTHOR` | hidden-state/unit PASS; UI round-trip BLOCKED |
| reading time | `readingTime` | not persisted | TipTap word count, 238 words/minute | hidden-state/unit/SQL PASS; visible UI boundary test BLOCKED |

Focused unit tests covered 0/237/238/239-word boundaries, the over-30-minute label and the AI-role values. SQL found no persisted `readingTime` key. These checks support but do not replace the blocked browser visibility/value matrix.
