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
  body editing and history restoration still use the full page.
- Search author/OR-label/title filters, navigation to highlighted results,
  subpage ordering, arbitrary history comparison, comment deep links, `/time`
  and localized slash-command matching.
- Page attachment gallery, sequential image/audio/video/PDF preview and safe
  asynchronous removal of unused files. See [the attachment contract](../PAGE_ATTACHMENTS.md).

The first two implementation commits are `33a86bf2` and `26d7cf6b`; the attachment
package follows them on local `main`. These packages have not been pushed or
deployed as part of this task.

## Remaining required work

- Finish the database record editing experience and compact view controls,
  including a collapsible long description.
- Footnotes across collaboration, copy/paste, search and exports; empty-page
  template selection; workspace preference for new users' initial edit mode;
  tabs and page presentation.
- Database system fields, multiple participants, file properties and a bounded
  formula language with consistent query/export/AI semantics.
- Public GitHub previews, authorized GitHub/GitLab/Figma connections, DOCX export,
  read-only user OAuth for inbound MCP and block-level RTL.
- Check the applicability of the listed upstream fixes before changing the
  corresponding fork paths. Keep stack upgrades separate.
- Measure the real-model benchmark on fixed tuning/holdout settings and run the
  remaining editor, Agent and AI-context browser matrices and release gates on
  the final isolated production-like runtime.
- Publish the final commits, wait for CI, build a verified immutable image,
  rehearse against a production copy, perform coordinated backup and deployment,
  and verify the resulting application and collaboration runtime.

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

These receipts establish only the checks actually completed for this checkpoint;
they do not substitute for the remaining roadmap features or final release gate.
