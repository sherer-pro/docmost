# Docmost archive format

Docmost archive is the lossless ZIP format used to move content between
spaces. Markdown, HTML, and PDF remain presentation formats and are not used
as the canonical restore payload.

## Version 2 layout

- `docmost-metadata.json` — manifest with `source: "docmost"`,
  `schemaVersion: 2`, export scope, display name, and the legacy page-path map.
- `docmost-data.json` — canonical ProseMirror page JSON, portable space
  settings, databases, labels, dictionary terms, user references, and
  attachment descriptors. External synced-block sources are stored as
  snapshots so they can be restored as ordinary editable blocks.
- `files/<sourceAttachmentId>/<fileName>` — attachment payloads.
- Markdown page files — a human-readable compatibility representation.

The importer rejects archives created with a newer schema and archives that
contain editor nodes unsupported by the running server. It never silently
drops an unknown node. Attachment descriptors include a SHA-256 checksum;
preview verifies both the declared size and checksum before a task can start.

## Imported and excluded data

The archive restores pages, page settings, databases and views, attachments,
labels, dictionary terms, and synced blocks. All entity identifiers are
regenerated. Page and user references are remapped before the transaction is
committed.

### Synced blocks

Lossless synced-block restoration is available only through the Docmost
archive. References whose source page is part of the same archive are remapped
to the new page identifiers and remain synchronized. An accessible reference
to a source outside the archive is stored in `transclusionSnapshots` and is
restored as ordinary editable content. References that the exporting user
cannot read are never included in `transclusionSnapshots`; the importer
replaces them with an unavailable-content placeholder.

Markdown, HTML, and PDF exports are presentation-only representations. They
materialize each synced block as a labeled, framed block with its current
content, or with a localized unavailable-content placeholder. Importing those
formats does not recreate synchronization relationships.

Workspace members, access rules, public shares, comments, history, favorites,
API keys, and personal preferences are intentionally excluded. Space identity
and security settings are not overwritten. Portable document-field,
dictionary, and heading-numbering settings are applied only when selected in
the import preview. Document fields and heading numbering require permission to
manage the target space settings; dictionary import requires a workspace
administrator. Unavailable groups are disabled while content import remains
available.

## Import workflow

1. `POST /api/pages/actions/import-zip/preview` uploads and validates the ZIP.
2. `POST /api/pages/actions/import-zip/confirm` records selected setting groups
   and starts the background task.
3. `POST /api/pages/actions/import-zip/cancel` removes a pending upload.
4. `POST /api/file-tasks/info` returns the persisted preview and final report.

Structural data is committed atomically. Attachment payloads are staged before
the database transaction and removed if the transaction fails. Re-importing an
archive always creates a new copy; it never updates source objects.

## Compatibility

Version 2 archives keep the legacy Markdown page map for older consumers.
When a human-readable Docmost ZIP marks heading numbers as materialized, the
generic importer removes them exactly. For older archives without the flag,
numbers are removed only when the complete H1-H3 sequence matches Docmost's
hierarchical numbering algorithm. Ambiguous manual-looking prefixes are
preserved and recorded in the import report.
