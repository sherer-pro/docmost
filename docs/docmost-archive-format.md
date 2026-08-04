# Docmost archive format

Docmost archive is the lossless ZIP format used to move content between
spaces. Markdown, HTML, and PDF are presentation formats and are not canonical
restore payloads.

## Version 3 layout

- `docmost-metadata.json` is the manifest with `source: "docmost"`,
  `schemaVersion: 3`, export scope, display name, and the legacy page-path map.
- `docmost-data.json` contains canonical ProseMirror page JSON, portable space
  settings, databases, labels, dictionary terms, user references, attachment
  descriptors, synced-block snapshots, and whole-page embed snapshots.
- `files/<sourceAttachmentId>/<fileName>` contains attachment payloads.
- Markdown page files provide a human-readable compatibility representation.

Version 3 preserves `pages[].isTemplate` and `pageEmbed` occurrence IDs.
Whole-page references to pages inside the archive are remapped to imported page
IDs and remain live. For an accessible source outside the archive,
`pageEmbedSnapshots` stores a presentation snapshot keyed by
`referencePageId + referenceNodeId + sourcePageId`. The key is occurrence-scoped,
so policy and attachment fallback are evaluated independently for each consumer.
Referenced attachments are copied with a stable per-consumer mapping and owned
by the imported consumer page; import materializes the snapshot as ordinary
editable content. If no safe
snapshot exists, import writes a neutral placeholder and never retains the
cross-workspace reference. Derived reference rows are rebuilt from page content.

The importer continues to accept version 2 archives. It rejects archives made
with a newer schema and archives containing editor nodes unsupported by the
running server. It never silently drops an unknown node. Attachment descriptors
include SHA-256 checksums; preview verifies both size and checksum before a task
can start.

## Imported and excluded data

The archive restores pages, page settings, databases and views, attachments,
labels, dictionary terms, synced blocks, template markers, and supported live
page relationships. All entity identifiers are regenerated. Page, attachment,
and user references are remapped before the transaction commits.

Database roots, database rows, and database content cannot contain live
`pageEmbed` nodes in v1. Import clears a template marker on those pages and
replaces any such node with a neutral placeholder.

### Synced blocks and page embeds

References whose source page is in the same archive are remapped and remain
synchronized. Accessible external synced blocks use `transclusionSnapshots`;
accessible external page embeds use `pageEmbedSnapshots`. Both become ordinary
editable content on import. Sources the exporting user cannot read are never
included as snapshots.

Markdown, HTML, and PDF recursively materialize currently permitted live page
embeds and synced blocks. Rendering is depth-bounded; an unavailable source is
represented by a localized neutral placeholder. Importing those formats never
recreates a live relationship.

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

## Compatibility

Version 2 and 3 archives keep the legacy Markdown page map for older consumers.
Version 2 has no template marker or whole-page snapshot sidecar, so only its
existing data is restored. Heading-number compatibility follows the same
materialized-number rules used by the generic importer.
