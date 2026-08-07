WITH acceptance (criterion, result, evidence) AS (
  VALUES
    ('Cross-tenant read/write', 'PASS', 'Two-way object and integrity checks'),
    ('ACL across channels', 'PASS', 'UI, API, search, export, files, DB, AI, RAG, MCP'),
    ('Immediate share disable', 'PASS', 'Workspace and space policy switches'),
    ('Cache and index revoke', 'PASS', 'No-store and live hydration on DB/Typesense'),
    ('API key ceiling', 'PASS', 'Creator membership, ACL, scope, and capabilities'),
    ('Private-object oracle', 'PASS', '404 normalization except documented RAG contract')
)
SELECT * FROM acceptance;

WITH workspace_roles (
  role,
  settings,
  members,
  spaces,
  groups,
  attachments,
  api_keys
) AS (
  VALUES
    ('owner', 'Manage', 'Manage', 'Manage', 'Manage', 'Manage', 'Manage'),
    ('admin', 'Manage', 'Manage', 'Manage', 'Manage', 'Manage', 'Manage'),
    ('member', 'Read', 'Limited read', 'Accessible only', 'Visible only', 'Within object ACL', 'Denied by service')
)
SELECT * FROM workspace_roles;

WITH space_roles (role, settings, members, pages, shares) AS (
  VALUES
    ('workspace owner/admin', 'Manage', 'Manage', 'System access', 'System access'),
    ('space admin', 'Manage', 'Manage', 'Manage', 'Manage'),
    ('writer/editor', 'Read', 'Read', 'Manage', 'Manage'),
    ('reader/viewer', 'Read', 'Read', 'Read', 'Read'),
    ('no membership', 'None', 'None', 'None', 'None')
)
SELECT * FROM space_roles;

WITH page_capabilities (
  source,
  read,
  update,
  create_child,
  move_delete_share,
  manage_acl
) AS (
  VALUES
    ('workspace owner/admin (system)', 'Yes', 'Yes', 'Yes', 'Yes', 'Yes'),
    ('space admin/writer (space)', 'Yes', 'Yes', 'Yes', 'Yes', 'No'),
    ('explicit user/group writer', 'Yes', 'Yes', 'Yes', 'No', 'No'),
    ('space/page reader', 'Yes', 'No', 'No', 'No', 'No'),
    ('explicit deny / no access', 'No', 'No', 'No', 'No', 'No')
)
SELECT * FROM page_capabilities;

WITH actor_matrix (actor, read_scope, mutations, access_constraint) AS (
  VALUES
    ('workspace admin', 'Own workspace', 'Admin and page ACL', 'Tenant boundary always applies'),
    ('space admin', 'Own space', 'Update/delete/move/share', 'Cannot manage page ACL'),
    ('editor/writer', 'Own space', 'Update/delete/move/share', 'No page ACL or API keys'),
    ('viewer/reader', 'Readable objects', 'None', 'Revocation rechecked server-side'),
    ('group member', 'Group role or page ACL', 'Writer: update/create child', 'No move/delete/share from page ACL'),
    ('other-space user', 'None by default', 'None by default', 'Same-workspace explicit ACL may grant'),
    ('other-workspace user', 'None; 404', 'None; 404', 'UUID and bulk tenant-scoped'),
    ('anonymous', 'Active public subtree', 'None', 'Workspace/space switch rechecked'),
    ('revoked user', 'None; 401', 'None; 401', 'Open tab does not retain access')
)
SELECT * FROM actor_matrix;

WITH channel_matrix (channel, boundary, result) AS (
  VALUES
    ('UI / Playwright', 'Isolated role cookies', 'Visibility matches API'),
    ('Direct API / UUID', 'Object + workspace scope', 'Private and foreign IDs denied'),
    ('Update/delete/move/bulk', 'Capabilities + tenant', 'Denied object unchanged'),
    ('PostgreSQL search', 'Filter + hydration', 'Revoked ACL removed'),
    ('Typesense search', 'Index + hydration', 'Stale index hit removed'),
    ('Export', 'Root + descendants', 'Denied subtree pruned'),
    ('Attachments', 'Page ACL + token', 'Foreign/private denied'),
    ('Database rows', 'Space + row page ACL', 'List and target filtered'),
    ('Comments', 'Page mutation access', 'Reader create denied'),
    ('AI context', 'Current page access', 'Private page excluded'),
    ('RAG API', 'Key scope + creator ACL', 'Demotion narrows output'),
    ('Incoming MCP', 'Key capabilities + ACL', 'Read-only and scoped'),
    ('Public sharing', 'Workspace + space policy', 'Disable closes all routes'),
    ('Open-tab/cache', 'No-store + live recheck', 'Revocation takes effect')
)
SELECT * FROM channel_matrix;
