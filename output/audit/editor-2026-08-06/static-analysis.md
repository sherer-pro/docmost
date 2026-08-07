# Editor static analysis

Date: 2026-08-06

## Schema and rendering parity

- The client schema is assembled in `apps/client/src/features/editor/extensions/extensions.ts`.
- The collaboration, import, and export schema is assembled in
  `apps/server/src/collaboration/collaboration.util.ts`.
- Both schemas register the fork nodes `heading`, `pageBreak`, `tag`,
  `transclusionSource`, `transclusionReference`, and `pageEmbed`, plus tables,
  media, diagrams, embeds, mentions, details, math, callouts, and attachments.
- `ReadonlyPageEditor` reuses `mainExtensions`, replaces only `UniqueID` with
  `updateDocument: false`, and passes `editable={false}`. This keeps node-view
  rendering aligned between authenticated read mode and public shares while
  preventing read-only ID mutations.
- `PageEditor` initially renders the database JSON through a read-only static
  provider and swaps to the collaborative editor only after local and remote
  Yjs synchronization. This boundary is the critical lifecycle regression
  surface introduced/modified by `2652053d`.

## Serialization and export

- Server HTML and JSON conversion uses the same `tiptapExtensions` schema via
  `jsonToHtml`, `htmlToJson`, and `jsonToText`.
- Markdown export converts generated HTML with the shared Turndown adapter.
- Internal page mentions are materialized as canonical links before export;
  internal links are rewritten to relative paths for archives.
- Page breaks serialize as `<div data-type="pageBreak" class="page-break">` and
  print CSS applies `break-after: page`.
- PDF export uses a locally resolved Chromium executable and blocks every
  resource except safe image data URLs, `about:blank`, and same-origin public
  attachment paths. Attachment-specific tokens are injected per request.
- PDF Mermaid rendering uses the shared `MERMAID_SANITIZATION_POLICY`, strict
  Mermaid mode, and preserves the original code block when rendering fails.

## Sanitizers

- Link marks pass through `@braintree/sanitize-url`; empty, `about:blank`, and
  protocol-relative results are rejected.
- Audio and PDF nodes accept only sanitized internal attachment URLs.
- Generic embed node views require an HTTP(S) URL whose origin is in the
  configured frame-source policy.
- Mermaid is rendered with `securityLevel: "strict"`, then sanitized again.
  Executable tags, event attributes, unsafe CSS URLs/expressions, protocol-
  relative URLs, and non-allowlisted protocols/data-image MIME types are
  removed. Invalid read-only diagrams expose a generic localized error instead
  of parser details.

## Clipboard and paste

- Markdown paste recognizes VS Code markdown metadata and also transforms
  ordinary rich plain text when it is not a standalone link or explicit
  plain-text paste.
- Heading-numbering cleanup removes pasted manual numbering only when the
  space-level cleanup flag is enabled.
- Table paste normalizes malformed rows and applies the current default width
  mode.
- Transclusion/page-embed copy materializes referenced content into both HTML
  and Markdown/plain-text payloads, bounds recursive page-embed expansion, and
  substitutes an unavailable label when resolution fails.
- Managed page embeds are intentionally inserted/detached only through the
  idempotent template API with a base-content hash and graph lease; direct JSON
  insertion is not a valid production path.

## Node views and media

- Image, Draw.io, Excalidraw, and Mermaid expose a read-only lightbox.
- Draw.io and Excalidraw save by uploading/replacing an attachment and then
  updating `src`, `title`, `size`, and `attachmentId`; a save guard prevents
  duplicate writes.
- Audio renders a native `<audio controls>` element with metadata preload.
- PDF renders through the internal attachment URL node view.
- Image/video/diagram accessible names are sourced from persisted `alt` or
  `title` attributes.

## Confirmed code-level gaps, remediations, and risks

1. **Table resize is disabled.** `CustomTable.configure({ resizable: false })`
   means the requested browser resize path cannot pass in the current client.
   The history confirms this was an explicit removal in `4059f469`.
2. **Resolved: copied Draw.io nodes previously retained mutable attachment
   identity.** Clipboard parsing still restores `data-attachment-id`, but
   `DrawioView` now applies copy-on-write when another document node references
   the same attachment. Focused Chromium and Firefox checks confirmed that the
   source ID stays unchanged and the saved copy receives a new ID.
3. **WebKit cannot load this production CSP over the configured local HTTP
   origin.** Its implementation applies `upgrade-insecure-requests` to the
   manifest, scripts, styles and runtime config, then rejects the resulting
   HTTPS requests because the local service has no TLS endpoint. The WebKit
   tests remove only that directive from intercepted response headers; this is
   a disclosed transport shim, not a sanitizer bypass.
4. **External diagram editing remains environment-dependent.** Draw.io editing
   depends on `DRAWIO_URL`; the local audit does not use a public converter and
   instead drives the documented iframe export message locally.
5. **Rich clipboard support varies by browser.** The code falls back to
   `navigator.clipboard.writeText`, but actual read/write permission and MIME
   support differs. Firefox ignores the constructor-supplied `DataTransfer` on
   synthetic `ClipboardEvent`, so the harness defines the event's own
   `clipboardData` property while still exercising the production paste
   handler. All desktop paste scenarios then passed.

The final two-context collaboration test passed bidirectionally in Chromium and
Firefox, including public readonly share and offline recovery. Earlier
diagnostic observations of JSON/Yjs divergence were not reproduced in the
isolated final run and are therefore not reported as findings.
