# Page templates and transclusion audit (2026-08-09)

## Scope and current contract

The audited contract on `main` consists of `regular` and `synced` page
templates plus block-level `transclusionSource` / `transclusionReference`
nodes. New whole-page `pageEmbed` nodes are not a public feature. The node is
kept only so legacy data can be materialized during migration/export.

Status meanings: `PASS` was demonstrated in this audit, `FAIL` is a confirmed
product defect, `BLOCKED` could not complete because of the stated runtime or
harness condition, and `UNTESTED` has no current evidence.

## Confirmed fixes

- Authenticated lookup providers now coalesce `page-embed:invalidate` events,
  refresh every active lookup key, preserve the last successful result during
  a retry, and fence stale requests.
- Source updates whose `PAGE_UPDATED` event omits `workspaceId` now resolve the
  source page before querying consumers. Block references are included rather
  than filtering only legacy page references.
- Read-only nested editors are versioned by `sourceUpdatedAt`, so a successful
  realtime lookup replaces the rendered TipTap snapshot.
- The editor bubble menu exposes `Create synced block` only for allowed
  top-level selections and never inside another synced block. All shipped
  locales and editor action labels were updated.
- Clipboard parsing rejects malformed source/reference UUIDs instead of
  constructing damaged custom nodes.
- Legacy `pageEmbed` migration materializes bounded, non-recursive messages for
  cycles, excessive depth, deleted sources, and denied sources.
- The editor audit runner uses `allowRegularTemplate` and
  `allowSyncedTemplate`, provisions a separate member context, sanitizes trace
  archives, and verifies exports with local parsers.

## Automated verification

| Check | Status | Evidence |
| --- | --- | --- |
| Transclusion lookup provider | PASS | 9 Vitest cases, including retry, batching, coalescing, cached content, and stale-request fencing |
| Nested read-only editor refresh | PASS | 5 Vitest cases, including remount on lookup version change |
| Bubble-menu eligibility | PASS | 3 focused Vitest cases |
| Editor extension schema and clipboard | PASS | 62 tests; text, list, table, image, diagram, malformed payloads, and UUID validation |
| Template, policy, legacy embed, and transclusion services | PASS | 37 focused Jest cases |
| Export/import services | PASS | 27 focused Jest cases |
| WebSocket authorization and invalidation | PASS | 16 focused Jest cases |
| Server/client security suites | PASS | Server: 66 suites / 766 tests; client: 6 files / 74 tests |
| Client typecheck and production build | PASS | TypeScript and Vite production build completed |
| Route inventory | PASS | 310 routes, no drift |
| Text contracts and English comments | PASS | Both repository checks completed |
| `verify:full` after the final render fix | UNTESTED | Not repeated after the final two-file render change |

## Browser matrix

### Templates

| Scenario | Status | Notes |
| --- | --- | --- |
| Regular and synced template CRUD | PASS | Chromium and Firefox |
| Blank and from-source creation | PASS | Both template kinds exercised |
| Workspace, space, role, and group policies | PASS | Member and administrator contexts |
| Cross-space template ID attempt | PASS | Rejected by the API |
| Edit, publish, revisions, sync, and retry | PASS | Two revisions plus retry acceptance |
| Fields and managed blocks | PASS | Created, synchronized, and detached |
| Archive and archived-template use | PASS | Archive succeeds; creation from archived template is rejected |
| Duplicate and detach | PASS | Duplicate loses template provenance; detach materializes managed nodes |
| Public creation of `pageEmbed` through URL or slash menu | PASS | No creation surface and no new `pageEmbed` node |

### Legacy whole-page embeds

| Scenario | Status | Notes |
| --- | --- | --- |
| Nested embeds and A to B to A cycle | PASS | Server/migration fixtures terminate with bounded materialization |
| Excessive depth | PASS | Bounded safe message |
| Deleted or stale source | PASS | Safe materialization without source content |
| ACL-denied source | PASS | Safe materialization without source content |

### Synced blocks

| Scenario | Status | Notes |
| --- | --- | --- |
| Text, list, table, media, and Mermaid source/reference | PASS | Chromium and Firefox reached materialized exports |
| First lookup intercepted with local `503` and automatic retry | PASS | Trace shows `503`, automatic `200`, and retained successful content |
| Two open authenticated pages and live source edit | PASS | Chromium and Firefox updated without manual refresh |
| Rename, move, delete, restore, and ACL revoke | PASS | Lookup is fail-closed while unavailable and recovers on restore/grant |
| Read-only and public share | PASS | Public lookup follows the share graph; moving the source outside it produces `no_access` |
| Reference search | PASS | Source and reference pages are returned without hidden-page metadata |
| Permitted and denied unsync | PASS | Denied request returns `403`; permitted unsync leaves source JSON unchanged |
| Copy/paste source and reference | PASS | Unit/schema coverage; browser test reached source clipboard serialization |
| Ordinary and malformed clipboard payload | PASS | Unit/schema coverage |
| Selection and slash-menu workflow in the final desktop run | BLOCKED | The late Firefox worker was stopped after the user requested a faster handoff; focused UI and unit evidence exists, but the final combined scenario did not finish |
| Pixel and iPhone rendering | PASS | Existing editor mobile acceptance projects passed in the stable audit run |

## Export matrix

Artifacts are under
`output/audit/page-templates-transclusion-2026-08-09/`. Markdown was parsed
with local `markdown-it`, HTML with `lxml`, PDFs with `pypdf`, `pdfinfo`, and
Poppler rendering, and archives with the standard JSON/ZIP parsers. No external
analysis service was used.

| Format | Status | Notes |
| --- | --- | --- |
| Markdown | PASS | Text/list/table/Mermaid materialized; no internal node or service attributes |
| HTML | PASS | DOM parsed; no internal node attributes, event handlers, or executable URLs |
| PDF text/table/Mermaid | PASS | One A4 page in each desktop engine; extracted text and rendered diagram are present |
| PDF media image | FAIL | Poppler render shows the image alt text with a broken-image icon instead of the PNG |
| `docmost` schema-v4 archive | PASS | Two pages, five valid internal references, no foreign dangling IDs |
| Archive import round-trip | PASS | Focused export/import service tests |
| Denied/deleted presentation export | PASS | Fail-closed placeholders contain no source content |

## Safety and artifacts

- The last sanitizer pass processed 158 text files and 5 trace archives,
  performed 9,167 redactions, and found zero residual credentials.
- No storage-state file contains the supplied administrator cookies.
- The isolated audit runtime was bound to loopback only. Failed audit spaces
  were retained as diagnostic fixtures; the runtime container was removed at
  handoff.

## Remaining risk

The acceptance gate is not fully green because PDF media materialization is a
confirmed failure and the final combined Firefox clipboard/selection tail was
stopped before completion. These statuses must not be treated as a release
pass. The functional fixes above have focused automated coverage and the core
realtime/ACL/export paths were exercised in both desktop engines.
