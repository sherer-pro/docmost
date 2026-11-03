# Page attachment gallery

Ordinary attachment search indexes UTF-8 Markdown and plain-text contents in
addition to PDF and DOCX. Opaque file names do not prevent content matches.
Existing page ACL checks apply before returning results. Extraction retains the
50 MiB file and 1000000-character text limits and rejects malformed UTF-8 or
binary text. Existing eligible text files are queued by the plain-text backfill;
active claims and unrelated terminal failures are retained.

An overwrite whose target is absent or mismatches the workspace, page or
extension returns the same `409 attachment_target_conflict` response without
target metadata. Diagram editors use that explicit conflict to create a separate
attachment when saving a pasted copy. They never generally retry creation for a
400, unrelated conflict, permission denial or storage error. The destination
page write check runs before the upload service and remains authoritative.

The authenticated page details dialog has an Attachments tab. It lists files
owned by the page and files referenced in its saved editor content whose source
page the user can currently read. Pagination and filename search follow those
access checks. Responses contain display metadata and usage block identifiers,
never storage paths or extracted file text. Public shares do not expose this API.

The gallery opens sequential image, audio, video and PDF previews. Images retain
the existing zoom, pan, touch and keyboard controls. Native media controls keep
their arrow keys, and Escape closes the preview before the containing details
dialog. The sequence contains the currently loaded search results. Download
requests reauthorize the attachment through the existing file endpoint.

## Removal and history

Gallery metadata columns have local bounds: type and size stay readable, size
does not split across lines, and long file names and action labels wrap within
the available space. Page details keep the same gallery instance when resized;
the selected tab, search and loaded pages survive breakpoint changes. The details
tab list becomes a two-by-two grid below 48em.

`GET /api/pages/:pageId/attachments` accepts `query`, `limit` and `cursor`.
`POST /api/pages/:pageId/attachments/:attachmentId/actions/remove` requires both
space administration and current page write access. It only removes files owned
by that page. A reader, ordinary writer or container-page editor without source
access cannot remove another page's files.

Removal locks the page and attachment metadata and checks references in all
workspace pages (including trash), page history content and change data, template
revisions and database cells. File-property mutations persist their row history
in the same transaction as the cells, so clearing a file cannot open a gap before
the ordinary history aggregation window expires. A history write failure rolls
back the cell mutation. The database root receives only its access-safe summary.
A reference returns `409 attachment_in_use`, including files referenced
only by a historical version. This conservative check may retain an unused file
if its identifier occurs in text. History is never rewritten to make it deletable.
The existing duplicate-copy pin check also remains authoritative.

Accepted removal deletes metadata and creates the cleanup batch, cleanup items
and transactional queue outbox event in one transaction. The ordinary worker
removes storage later; the HTTP request does not delete the file synchronously.
A repeated request after acceptance returns 404 and creates no additional batch.
If an upload loses its metadata update to concurrent removal, the new upload
path is cleaned and no search-index request is issued for the missing record.

New inline media formats require matching extension, signature and trusted MIME.
Spoofed active content is rejected on upload or forced to download on reads of
legacy metadata. SVG uploads retain their existing protected download behavior.

## Verification

- The attachment service suites check authorization, MIME handling and the upload/removal race. `src/common/helpers/file-validation.media.spec.ts` checks all newly inline media signatures.
- `node apps/client/e2e/image-preview/run.mjs` checks existing image/SVG/Mermaid zoom plus generated audio/video playback and gallery navigation at 320, 390 and 1280 px in both themes. Two additional PDF cases use the full Chromium channel, check a nonblank native viewer and save screenshots for visual inspection. The default [headless shell omits the PDF viewer](https://playwright.dev/docs/browsers#chromium-new-headless-mode); install full Chromium for this runner. `--pdf-only` is a diagnostic subset.
- After a build, `node apps/client/e2e/database/run-live.mjs` checks real PostgreSQL/API ACL, pagination, usage, history protection and cleanup transactions, plus the attachment-gallery browser scenario. A `--grep` run is a diagnostic subset.

No migration or storage rewrite is required. Disabling the gallery UI does not
remove previously uploaded files or change document history.
