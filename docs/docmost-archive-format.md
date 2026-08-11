# Docmost archive format

Docmost archive is the lossless ZIP format used to move content between
spaces. Markdown, HTML, and PDF are presentation formats and are not canonical
restore payloads.

## Version 4 layout

- `docmost-metadata.json` is the manifest with `source: "docmost"`,
  `schemaVersion: 4`, export scope, display name, and the legacy page-path map.
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
values remain in the resulting editable document. The archive contract still
accepts the version 4 `pages[].templateKind` field for archives produced by older
releases, but importing such a field never creates an implicit cross-workspace
template dependency.

The importer continues to accept version 2 and 3 archives. Version 3
`pageEmbed` nodes and their optional `pageEmbedSnapshots` are materialized into
ordinary editable content during import; no live whole-page relationship is
recreated. It rejects archives made
with a newer schema and archives containing editor nodes unsupported by the
running server. It never silently drops an unknown node. Attachment descriptors
include SHA-256 checksums; preview verifies both size and checksum before a task
can start.

## Imported and excluded data

The archive restores pages, page settings, databases and views, attachments,
labels, dictionary terms, and synced blocks. Template catalog pages are outside
the current export scope. All entity identifiers are regenerated. Page, attachment,
and user references are remapped before the transaction commits.

Database roots, database rows, and database content cannot contain legacy
`pageEmbed` nodes. Import clears a template kind on those pages and materializes
or replaces each such node with a neutral placeholder.

### Synced blocks and legacy page embeds

Synced-block references whose source page is in the same archive are remapped and
remain synchronized. Accessible external synced blocks use
`transclusionSnapshots` and become ordinary editable content on import. Version 3
page-embed snapshots are accepted only for backward-compatible materialization.

Markdown, HTML, and PDF materialize legacy page embeds and synced blocks.
Rendering is depth-bounded; an unavailable source is
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
dictionary, and heading-numbering settings are applied only when selected in
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
Malformed manifests, unsupported versions, CRC errors, and attachment size or
checksum mismatches are rejected before import.

File-task preview, progress, and report metadata is scoped to the workspace and
is visible only to the task creator or a workspace member allowed to manage
workspace settings. The client persists an active task identifier per space,
resumes polling after reload, and clears it only after success, failure, or
cancel.

## Compatibility

Version 2, 3, and 4 archives keep the legacy Markdown page map for older
consumers. Version 2 has no template marker or whole-page snapshot sidecar.
Version 3 `isTemplate` is imported as `regular`; version 4 accepts
`templateKind` from older archives for backward compatibility. Current space
exports do not emit template catalog pages.
Heading-number compatibility follows the same materialized-number rules used by
the generic importer.
