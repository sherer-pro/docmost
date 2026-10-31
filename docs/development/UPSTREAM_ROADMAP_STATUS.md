# Upstream roadmap implementation checkpoint

Date: 2026-10-31. The user resumed implementation of all remaining work in
stages 1–4. Push and deployment are explicitly on hold. Stages 1–4 are not
complete; final release acceptance and CI remain pending.

## Implemented packages

- AI view queries and full-selection aggregates, internal Agent cell proposals
  with revision checks and transactional receipts, administrative restrictions,
  and a deterministic database benchmark corpus. Real-model holdout quality has
  not been measured.
- Kanban, view-specific row order, personal view drafts, column layout, linked
  database embeds, complete-view CSV and URL-addressable record previews. Record
  body/title editing and restorable history now use isolated editor state in the
  side panel. Compact controls, personal toolbar pinning and collapsible long
  descriptions complete the database navigation package.
- Search author/OR-label/title filters, navigation to highlighted results,
  subpage ordering, arbitrary history comparison, comment deep links, `/time`
  and localized slash-command matching.
- Page attachment gallery, sequential image/audio/video/PDF preview and safe
  asynchronous removal of unused files. See [the attachment contract](../PAGE_ATTACHMENTS.md).
- Collaborative footnotes, definition editing with conflict protection, search,
  Markdown/HTML/PDF/Docmost export and archive import; block-level automatic/explicit
  text direction; workspace initial editing preference copied only to new users.
  See [document blocks](../EDITOR_BLOCKS.md).
- Document tabs with collaborative rename/order/duplication, hidden-content search,
  stable citation anchors, complete exports and archive import; read-only page
  presentation with keyboard controls, long-slide scrolling, pointer and native
  full screen. Presentation forces database embeds to read-only.
- Empty-page application of regular and published synchronized templates with
  idempotency, current-access and source-revision checks, attachment compensation
  and an atomic persistence receipt. Native save-queue recovery is patched in
  Hocuspocus 3.4.4. Database descriptions and record panels do not offer this action.

The implementation commits include `33a86bf2`, `26d7cf6b`, `1c8bb87c`,
`f4b250be` and `85a71162`; the record/template package follows them on local `main`. These packages have not been pushed or
deployed as part of this task.

## Remaining required work

- Finish the trusted database query result summary and a link that restores the
  exact frozen selection while retaining the AI content-policy intersection.
  Add natural-language filter challenges that start from a different current
  view. Record actual transmitted RAG evidence and complete human-reviewed
  quality acceptance; database tool-trace correctness alone is insufficient.
- Database system fields, multiple participants, file properties and a bounded
  formula language with consistent query/export/AI semantics.
- Public GitHub previews, authorized GitHub/GitLab/Figma connections, DOCX export,
  read-only user OAuth for inbound MCP.
- Check the applicability of the listed upstream fixes before changing the
  corresponding fork paths. Keep stack upgrades separate.
- Measure the real-model benchmark on fixed tuning/holdout settings and run the
  remaining editor, Agent and AI-context browser matrices and release gates on
  the final isolated production-like runtime.

Push, remote CI for the new commits, image publication and deployment are a
separate operational follow-up explicitly on hold. The current authorization is
local implementation, verification and commits on `main`.

Stage 5 items (personal/public spaces, SIEM, calendar, rollups and new retrieval
drivers) remain outside the required scope of stages 1–4.

## Deployment finding

SSH access was verified with the operator-provided encrypted key. Read-only
inspection found a pre-existing Typesense restart loop: its capability-restricted
UID 0 process cannot read the shared key file owned by UID 1000 with mode `0600`.
The verified ownership and permission requirements are recorded in
[Search operations](../SEARCH.md#deploy-typesense-beside-docmost).
No production configuration, permission or container was changed. Address this
in the final deployment procedure and verify read access from both images.

## Local acceptance evidence

Local, ignored receipts are under `artifacts/`:

- `attachments-verify-complete.log`: build, contracts, lint and unit checks; security was interrupted by the pause and subsequently completed in `attachments-security-resumed.log`.
- `attachments-media-final.log` and `image-preview/results.json`: 26 image, media and PDF browser scenarios, with screenshots.
- `attachments-live-complete.log`: the earlier run passed the four gallery cases but failed while a second browser loaded assets from a concurrently rebuilt client directory.
- `attachments-isolated-acceptance.log`: the immutable runtime snapshot passed all five gallery/reader cases, PostgreSQL and HTTP checks, including physical storage cleanup.
- `attachments-isolated-full.log`: all 28 browser cases passed with 20 PostgreSQL tests and the complete HTTP/export/import checks; cleanup completed successfully.
- `attachments-doc-contracts-final.log`: bilingual fork documentation, comment language and text normalization checks.
- `attachments-graph-update.log`: successful local Graphify update.
- `attachments-graph-import.log`: AgentMemory import could not run because the shared service at `http://127.0.0.1:3111` is stopped. Its configuration was not changed and the service was not started.
- `footnote-live-final.log`: all three browser cases passed (Chromium, Firefox,
  WebKit), together with 20 PostgreSQL cases and the HTTP/export/import checks.
- `footnote-direction-browser.log`: editing, undo/redo, search, null-editor
  lifecycle and mixed-language block direction passed in both themes and sizes.
- `footnote-direction-editor-tests.log`: 117 shared editor tests passed.
- `initial-editor-server-tests.log` and `initial-editor-client-tests.log`: 27
  server and 9 client preference tests passed.
- `footnote-preference-direction-build.log`: complete monorepo build passed.
- `footnote-package-lint.log`: lint passed with the existing frontend warnings.
- `document-blocks-final-live.log`: six footnote/tab/presentation cases passed
  across Chromium, Firefox and WebKit, with PostgreSQL, HTTP, downloaded artifacts,
  archive import and nested-tab rejection checks.
- `tabs-search-subscription-fixed.log` and `editor-blocks/results.json`: both themes
  and desktop/mobile sizes passed, including native full screen and search that
  already exists when a tab renderer mounts.
- `search-editor-replacement-reproduction.log` and
  `search-editor-replacement-fixed.log`: a reproduced loss of the URL search term
  during editor replacement now has a regression test.
- `document-workflows-maintenance.log`: the reviewed maintenance baseline passed.
- `record-template-final-browser-matrix.log`: all six record title/body editing
  scenarios passed in Chromium, Firefox and WebKit, including mobile dark mode,
  reader access and preservation of the background table state. The original
  assertion timeouts are unchanged.
- `record-template-verify-full-accepted.log`: `verify:full` passed, including
  281 backend suites (2418 tests), 191 frontend files (928 tests), 79 backend
  security suites (972 tests) and 78 frontend security tests. Lint retained its
  existing 41 warnings and reported no errors.
- `record-template-final-editor-ext.log`: all 127 shared editor tests passed.
- `record-template-overview-contracts.log`: the approved English/Russian
  enhancement overviews passed their source-backed parity contract.

## Model benchmark connection

The configured production model is `gemma4:31b`. Its current HTTPS endpoint fails
the normal pinned TLS request with `ERR_TLS_CERT_ALTNAME_INVALID`; no certificate
checks or production settings were changed. The operator selected local LM Studio
at `http://127.0.0.1:56254` for benchmark work. Its loaded model is
`google/gemma-4-12b-qat`, with a loaded context of 90624 tokens. Model-list and
runtime connectivity checks are separate from the still-pending corpus run and
human evidence review required by `tests/rag-quality/README.md`.

LM Studio rejects a named-function `tool_choice` object with HTTP 400. The
capability probe now offers one tool with the supported `required` choice and
retains exact name, argument and single-call validation. The new isolated
database quality runner records actual durable Agent tool steps. Its second
six-case calibration produced six correct tool traces; human answer review is
pending. The extended version 3 corpus contains 160 database cases (96 tuning,
64 holdout), including actual null cells and prompt injection. The complete
tuning capture is in progress; this is not a measured or accepted holdout result.

These receipts establish only the checks actually completed for this checkpoint;
they do not substitute for the remaining roadmap features or final release gate.
