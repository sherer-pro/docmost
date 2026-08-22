# Docmost archive format

Docmost archive is the lossless ZIP format used to move content between
spaces. Markdown, HTML, and PDF are presentation formats and are not canonical
restore payloads.

## Version 5 layout

- `docmost-metadata.json` is the manifest with `source: "docmost"`,
  `schemaVersion: 5`, export scope, display name, and the page-path map used by
  the human-readable Markdown representation.
- `docmost-data.json` contains canonical ProseMirror page JSON, portable space
  settings, databases, labels, dictionary terms, user references, attachment
  descriptors, and synced-block snapshots.
- `files/<sourceAttachmentId>/<fileName>` contains attachment payloads.
- Markdown page files provide a human-readable compatibility representation.

All ZIP entry names are relative. Presentation exports use the same
`files/<attachmentId>/<fileName>` layout, so an archive remains portable when
it is extracted into any directory.

Current space exports omit template catalog pages. Pages created from regular or
synchronized templates are exported as ordinary pages: synchronized template
containers are recursively unwrapped, while the managed content and local field
values remain in the resulting editable document. The V5
`pages[].templateKind` field preserves whether an exported catalog entry was a
regular or synchronized template. Import never creates an implicit
cross-workspace template dependency.

Export writes only schema V5. Preview, confirmation, and the background worker
accept only the exact numeric value `5`; schemas V2, V3, V4, malformed versions,
and newer versions are rejected with an explicit version error. V5 also forbids
every JSON object whose node `type` is `pageEmbed`, regardless of where or how
deeply it is nested. Validation is fail-closed before any page or attachment is
materialized. Unknown editor nodes are rejected instead of being silently
dropped. Attachment descriptors include SHA-256 checksums; preview verifies
both size and checksum before a task can start. The V5 exporter records the
actual payload buffer byte length. Preview accepts a legacy V5 descriptor with
`fileSize: null` only after reading the real payload and verifying its SHA-256;
the normalized size never bypasses byte accounting. An archive may describe at
most 10,000 attachments and at most 512 MiB of aggregate logical attachment
bytes. The verified physical payload size is counted once per descriptor, even
when multiple descriptors name the same `archivePath`.

## Imported and excluded data

The archive restores pages, page settings, databases and views, attachments,
labels, dictionary terms, and synced blocks. Template catalog pages are outside
the current export scope. All entity identifiers are regenerated. Page, attachment,
and user references are remapped before the transaction commits.

No V5 field, including page content, snapshot content, settings, database
descriptions, cells, or view configuration, may contain a `pageEmbed` node.

### Synced blocks

Synced-block references whose source page is in the same archive are remapped and
remain synchronized. Accessible external synced blocks use
`transclusionSnapshots` and become ordinary editable content on import. This is
the current transclusion snapshot contract and remains part of V5.

Markdown, HTML, and PDF materialize synced blocks. An unavailable source is
represented by a localized neutral placeholder. Importing those formats never
recreates a live relationship. Presentation output contains neither
`transclusionReference` nodes nor `data-source-page-id` or
`data-transclusion-id` service attributes. Source ACL is evaluated for the
exporting user; denied and deleted sources never contribute their content.

Database Markdown, HTML, and PDF exports capture the active filters, property
sort, and visible property columns. When descendants are requested, only rows
in that current view and their non-row descendants are included; a selected
nested row whose filtered parent is absent is reparented below the database
root in the presentation archive. Docmost archive export remains canonical and
always contains the full database with all saved views.

Workspace members, access rules, public shares, comments, history, favorites,
API keys, and personal preferences are intentionally excluded. Space identity
and security settings are not overwritten. Portable document-field,
dictionary, heading-numbering, and editor-tag settings are applied only when selected in
the import preview.

## Import workflow

1. `POST /api/pages/actions/import-zip/preview` uploads and validates the ZIP.
2. `POST /api/pages/actions/import-zip/confirm` records selected setting groups
   and starts the background task.
3. `POST /api/pages/actions/import-zip/cancel` removes a pending upload.
4. `POST /api/file-tasks/info` returns the persisted preview and final report.

Structural data is committed atomically. Attachment payloads are staged before
the database transaction, uploaded with bounded retries, and removed if an
upload or transaction fails. The success task state is written in the same
transaction as the restored rows, so a worker crash cannot leave committed
content behind a failed task or replay a committed import. Re-importing an
archive always creates a new copy; it never updates source objects.

ZIP validation preserves raw central-directory entries long enough to reject
duplicate names, absolute paths, path traversal, symbolic links, excessive path
depth, and excessive entry counts before JSZip can normalize or collapse them.
Every non-directory entry is then streamed through per-entry and cumulative
uncompressed-byte budgets before CRC32 validation. This streaming pass also
rejects archives whose actual data exceeds a forged central-directory size.
Malformed manifests, every schema other than V5, forbidden `pageEmbed` nodes,
CRC errors, and attachment size or checksum mismatches are rejected before
import. Confirmation also checks the persisted preview version, and the worker
revalidates both the extracted manifest and data so a replaced or forged upload
cannot bypass preview admission.

File-task preview, progress, and report metadata is scoped to the workspace and
is visible only to the task creator or a workspace member allowed to manage
workspace settings. The client persists an active task identifier per space,
resumes polling after reload, and clears it only after success, failure, or
cancel.

## Compatibility

The archive API is V5-only. V2, V3, and V4 archives are not accepted and there
is no in-process legacy conversion branch. A separate offline converter is
available for trusted legacy files:

```bash
corepack pnpm --filter ./apps/server archive:convert-v5 -- \
  --input=/absolute/path/to/extracted-v3-archive \
  --output=/absolute/path/to/converted-v5-archive
```

`--input` and `--output` may instead name individual JSON files. Directory mode
copies the extracted archive, rewrites `docmost-metadata.json` and
`docmost-data.json`, and preserves attachment and Markdown files. The command
does not load application environment variables and never connects to
PostgreSQL, Redis, storage, or a running Docmost instance. It resolves a legacy
whole-page node from its occurrence snapshot first, then from a page included
in the archive, then from a source snapshot. Missing, cyclic, and excessively
deep sources become neutral callouts. `pageEmbedSnapshots` are removed, while
the modern `transclusionSnapshots` contract remains intact. Attachments inside
materialized legacy content receive deterministic per-consumer descriptors;
their IDs and URLs are rewritten while the descriptor keeps the original
archive path and checksum. Import therefore creates a consumer-owned copy
instead of sharing the source page's attachment ownership. Repackage and
verify the converted directory before import; the V5 preview remains the
authoritative ZIP, checksum, quota, and node-schema validation gate.

For a single-file invocation, converting `docmost-metadata.json` updates only
that manifest; `docmost-data.json` must be converted in a separate invocation.
Directory mode is recommended because it converts both files together. The
converter refuses to overwrite an existing output path.

Current space exports do not emit template catalog pages.
Heading-number compatibility follows the same materialized-number rules used by
the generic importer.
