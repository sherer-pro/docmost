# Space administration and template policies

Space administration lives at `/settings/spaces`. Search matches names,
descriptions, and addresses before pagination. The default view shows active
spaces; archived and all-space views use the same stable, case-insensitive
name/UUID ordering and 20-item cursor pages. Filters and cursors live in the URL;
returning from settings also restores the saved list position, including after
reloading the settings page. Positions are saved for the current browser tab and
removed on sign-out.

`GET /api/spaces/administration` returns `SpaceAdministrationResponse` from
`@docmost/api-contract`. Workspace owners and administrators can see all their
workspace's spaces. Other users see accessible spaces, including page-only
access. Management details are limited to workspace administrators and direct
or group space administrators. Until required MFA/SSO is satisfied, the response
contains identity, archive status, and the sign-in requirement only. It never
returns provider URLs, credentials, models, instructions, or complete AI
configuration. AI states describe configuration and enablement, not a successful
provider health check. Public-link permission does not imply published content.
The existing `GET /api/spaces` contract remains available.

## Settings pages

`/settings/spaces/:spaceSlug/:section` retains global settings navigation and
provides eight sections: `general` (the default), `members`, `access`,
`documents`, `templates`, `navigation`, `ai`, and `maintenance`. Mobile layouts
use a section selector. Space menus and the `/spaces` catalog open these pages.
Creating a space from the administrative list opens its settings; creating from
the user catalog retains the content-first flow.

General, document, access, navigation, and template forms have explicit Save and
Cancel actions. Background refreshes do not replace dirty input; failures retain
it for retry. Template group permissions use a separate revision-checked form.
Revision conflicts require explicitly loading saved values before editing again.
Icon, member, label, export, archive, restore, and delete actions are independent
of form cancellation. Router navigation, including Back/Forward, uses a shared
unsaved-change blocker; closing or reloading a tab uses `beforeunload`.

`PATCH /api/spaces/:spaceId` receives changed fields. The workspace and space are
locked, merged settings and public-link deletion are committed together, and
authorization/RAG events follow the commit. Existing SSO readiness and
administrator privilege checks apply. A changed address replaces the current
settings URL. AI details remain at `/settings/ai/spaces/:spaceSlug`; links with
`?from=space-settings` return to the space's `ai` section.

Workspace general settings contain workspace identity and page-history
retention. Their scope is explained next to the controls. Template management
belongs to each space.

## Template policy transition

The template decision chain is `PAGE_TEMPLATES_ENABLED` on the server, local
space enablement, local action permissions, and existing group restrictions.
Ordinary group restrictions are intersected. Owners and workspace/space
administrators bypass group restrictions, but still obey the server and space
policy. This applies to the editor, linked-page updates, and AI template tools.
Other workspace AI/MCP policies remain separate and continue to apply.

Migration `20260919T180000-space-owned-template-policy.ts` changes each stored
space policy to `old local enabled AND old workspace enabled`. A missing
workspace policy means disabled. The environment switch is deliberately excluded
from data migration. Missing space policies and new spaces remain disabled.
Action permissions, templates, linked pages, and page contents are preserved.

The migration records original rows in `page_template_workspace_gate_backup`
and workspace/group policy snapshots in `page_template_workspace_gate_context`.
It increments local policy revisions so stale clients receive a conflict.
Rollback takes policy-table locks, verifies every current policy against the
migrated snapshot, and refuses if a policy was changed, added, or removed.
Only an unchanged dataset can restore the exact original local flags and
revisions. After later policy edits, use a coordinated backup recovery rather
than forcing the down migration. Do not delete these service tables manually.

For compatibility, local policy reads retain `workspaceEnabled: true`.
`GET /api/pages/templates/policies/workspace` returns `enabled: true`,
`revision: 0`, the real `systemEnabled`, and `deprecated: true`.
The former workspace PATCH returns HTTP 410 with
`page_template_workspace_policy_retired`. No workspace template switch affects
runtime behavior. Space and group writes keep `expectedRevision` checks.

## Verification

Client unit tests cover independent saves, retained drafts, revision conflicts,
and navigation blocking. Run `corepack pnpm --filter ./apps/client test`.
Browser acceptance uses synthetic API data with the real application routes:
`node apps/client/e2e/space-administration/run.mjs`.
It covers both entry points for creation, list recovery, keyboard focus, saves,
revision conflicts, all eight settings sections, two themes, English/Russian,
and 360/768/1440 px viewports. It checks both 200% text-size reflow and actual
200% Chromium browser zoom in every settings section, both languages, and both
themes. The zoom scenario uses a temporary isolated browser profile and a local
test-only extension; it does not install anything in the user's browser.
These checks do not establish physical-device acceptance or provider connectivity.

Settings and editor routes remain lazy. The clean release build fits the existing
260,000-byte initial JavaScript gzip budget and the isolated Excalidraw allowance
of 1,821,659 raw bytes. The release retains these budgets and importer checks.

The PostgreSQL acceptance suite requires an explicitly supplied, disposable
local database whose name ends in `_test`. Set
`SPACES_ADMIN_TEST_DATABASE_URL`, then run
`corepack pnpm --filter ./apps/server exec jest --config test/jest-e2e.json --runInBand test/space-administration.e2e-spec.ts`.
It creates and removes its own uniquely named schema. It covers filters,
pagination, role projections, MFA/SSO, atomic rollback, migration combinations,
content preservation, and refusal of unsafe rollback.
