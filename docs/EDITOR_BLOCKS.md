# Shared document blocks

## Integration links

`integrationPreview` and `integrationMention` retain only a canonical URL across
client/server/collaboration schemas, copy, search and exports. Provider titles
and descriptions are resolved privately for each viewer and never become
document, AI or RAG content. See [integration previews](INTEGRATION_PREVIEWS.md)
for configuration, supported links, credentials and acceptance boundaries.

## Footnotes

`footnote` is an inline atom containing plain child text (`text*`, no marks).
Each reference owns its definition. The stable node ID is repaired by the shared
UniqueID extension on creation and paste. A state plugin computes ordinal numbers
from current document order; it never writes numbers back to collaborative data.
The older attribute-only draft encoding remains readable. Existing imported note
text is preserved; the editor's new-note command and text field are bounded to
10000 characters.

The client renders a reference and an ordered definition list. Both editable and
read-only page renderers support navigation in both directions. Definition edits
replace the node's child text in an ordinary transaction and therefore support
undo and collaboration. A locally edited definition is not saved over a concurrent
change: the current text must still equal the editing baseline. Renderer contexts
without a definition list expose the definition in a popover.

Search works on child text, including notes. Positions are grouped only across
adjacent text nodes belonging to the same parent; a note cannot shift the offsets
of following paragraph text. The definition list highlights matching ranges and
reveals the current note without stealing focus from the find field.

HTML and PDF preparation number a copy of the materialized, authorized document
and append definitions and backlinks. Export IDs include the page ID so multi-page
exports do not collide. Markdown uses standard `[^n]` references and definitions;
its parser owns a per-document map, supports multiline definitions and never
expands notes inside code. Definition text is escaped as text. Docmost archives
retain the editor JSON and stable node IDs.

The API, collaboration and client reader schemas must be updated before enabling
the creation command in a deployment. Removing the command does not disable
reading saved notes. AI and RAG treat notes as ordinary document evidence and do
not automatically validate external references; see the canonical
[AI contract](AI_ASSISTANT_AND_RAG.md).

Verification uses `corepack pnpm test:editor-ext`, server collaboration/export
tests, the structured-evidence regression, and the isolated editor browser/export
acceptance. DOCX uses the same access-checked materialization and native Word
footnotes; see [DOCX export](DOCX_EXPORT.md).

## Initial editing preference

Workspace settings store `editor.defaultPageEditMode` (`read` or `edit`). The
value is copied into a user's `preferences.defaultPageEditMode` only at account
creation; existing accounts are not updated. Explicit per-page choices take
precedence. The initial workspace owner and accounts without a copied setting
retain the read default. This setting does not change page write permissions.

## Block direction

Paragraphs, headings, list items, task items, table cells and details summaries
render `dir="auto"` by default. The browser resolves direction independently from
the first strong character of each block. The `/ltr`, `/rtl` and automatic
direction commands set an explicit block attribute, shared by client and server
schemas and preserved by HTML, PDF and Docmost exports. Markdown retains the
text; explicit direction is an HTML presentation attribute. Code blocks retain
their existing direction. Table headings use logical start alignment.

The isolated document-block browser fixture runs with
`node apps/client/e2e/editor-blocks/run.mjs` and exercises mixed Russian, English,
Arabic and Hebrew paragraphs, lists and tables in both themes and sizes.

## Tabs

`tabs` contains one or more `tabItem` blocks with stable IDs and a plain-text
title. Each item holds ordinary document blocks. Creation and paste cannot nest
tabs, including through lists or other containers; API content validation uses
the same structural rule. No user code or remote content is evaluated.

The active item is local display state. A bounded memory cache keyed by user,
page and tabs ID preserves the choice when the static editor becomes live. It
does not write shared state or persist document contents. Renaming checks the
current title against the editing baseline. Add, duplicate, move and confirmed
delete use ordinary editor transactions and support undo and collaboration.
Keyboard navigation uses unmodified arrows/Home/End; document shortcuts such as
Ctrl+End retain their normal behavior.

All item bodies remain mounted for search. A matching hidden range or a section
link reveals its item. The item title is a canonical level-3 section with the
item's stable ID, so AI citations and heading links can reach inactive content.
Text, AI/RAG evidence and HTML/Markdown/PDF exports include every item, regardless
of the current selection. HTML/PDF expand all items; Docmost archives retain the
block structure. The reader extensions remain registered when creation is disabled.

## Presentation

The page action menu captures the current owned editor JSON, falling back to the
loaded page content. Headings, horizontal rules and page breaks split the copy
into slides. Only the current slide is rendered, with ordinary read-only block
readers. Comment marks are removed from the copy, preserving the source data.
Long slides scroll instead of shrinking or clipping text.

Arrow keys, PageUp/PageDown, Home/End and Space navigate. Tabs and media retain
their own keyboard controls. The viewer offers a pointer and browser full-screen
mode where supported. It uses no page-editor atoms and never attaches a write
collaboration provider. Embedded database controls are forced read-only even
when the user can edit the source database; source ACL checks remain independent.

## Templates on an empty page

An editable plain document offers the existing space template catalog while
its body contains only empty paragraphs. Applying a regular or published synced
template fills that document and preserves its title and location. Database
descriptions, row panels and template source pages do not offer this action.

`POST /api/pages/:pageId/actions/apply-template` uses the existing idempotency
lease and collaboration mutation protocol. The server reads current content,
checks page and template access and captures a content hash. Persistence
resolves the current user from the id-only internal actor, rechecks permissions,
source revision/hash and the empty target, then stores copied attachments,
provenance, content and the operation receipt in one transaction. A concurrent
edit rejects application; a repeated completed request returns its receipt.
Staged file bytes remain outside the transaction and are compensated on failure.

Migration `20261031T120000-empty-page-template-application` adds operation
metadata and the `template_apply` kind. Its down refuses to erase existing
application receipts; disabling creation is the operational rollback after use.
Existing readers already understand all reused template nodes.

The pinned Hocuspocus 3.4.4 patch clears rejected save-queue entries in `finally`.
Without it, a storage error prevents both live-document recovery and subsequent
operations on the same document. Native dependency tests and a real PostgreSQL
attachment-insertion failure verify the recovery path.
