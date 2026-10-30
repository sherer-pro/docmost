# Shared document blocks

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
acceptance. DOCX coverage belongs to the separate DOCX exporter package.

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
