# Docmost archive format

Docmost archive is the lossless ZIP format used to move content between
spaces. Markdown, HTML, and PDF are presentation formats and are not canonical
restore payloads.

## Version 4 layout

- `docmost-metadata.json` is the manifest with `source: "docmost"`,
  `schemaVersion: 4`, export scope, display name, and the legacy page-path map.
- `docmost-data.json` contains canonical ProseMirror page JSON, portable space
  settings, databases, labels, dictionary terms, user references, attachment
  descriptors, synced-block snapshots, and page template kinds.
- `files/<sourceAttachmentId>/<fileName>` contains attachment payloads.
- Markdown page files provide a human-readable compatibility representation.

All ZIP entry names are relative. Presentation exports use the same
`files/<attachmentId>/<fileName>` layout, so an archive remains portable when
it is extracted into any directory.

Version 4 preserves `pages[].templateKind`. Regular templates remain independent
snapshots when used. Synchronized templates are restored as unpublished template
drafts; imported ordinary pages keep their materialized content and never gain an
implicit cross-workspace template dependency.

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
  labels, dictionary terms, synced blocks, and template kinds. All entity
  identifiers are regenerated. Page, attachment,
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
recreates a live relationship.

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
the database transaction and removed if it fails. Re-importing an archive
always creates a new copy; it never updates source objects.

ZIP validation checks CRC32 while decompressing and applies per-entry,
cumulative-byte, nesting-depth, and entry-count limits. Absolute paths, path
traversal, symbolic-link entries, malformed manifests, unsupported versions,
and attachment size or checksum mismatches are rejected before import.

## Compatibility

Version 2, 3, and 4 archives keep the legacy Markdown page map for older
consumers. Version 2 has no template marker or whole-page snapshot sidecar.
Version 3 `isTemplate` is imported as `regular`; version 4 uses `templateKind`.
Heading-number compatibility follows the same materialized-number rules used by
the generic importer.
