# Integration link previews

Integration previews display links. They do not synchronize tasks, modify provider
content, or expose provider tools to AI. The implementation is independent of
upstream Enterprise code.

## Configuration and supported addresses

Previews start disabled. The server operator approves exact API origins in
`INTEGRATION_PREVIEW_ALLOWED_ORIGINS` (empty by default):

| Provider | Approved API origin | Supported link |
| --- | --- | --- |
| GitHub | `https://api.github.com` | Repository, issue, pull request, commit |
| GitLab | `https://gitlab.com` | Project, issue, merge request, commit; nested groups supported |
| Figma | `https://api.figma.com` | File/design/board/slides/prototype/make file metadata |

Workspace administrators enable **Link previews** in
`/settings/account/connections?tab=previews`. Each user independently saves or
disconnects their own provider token there. Public GitHub links need no token.
GitLab and Figma require a personal connection in this version. Self-hosted
GitLab, GitHub Enterprise, Linear, Jira and Azure DevOps are outside this version.

Use a token with only the required read permissions for the chosen resources.
GitHub uses read-only REST endpoints and API version `2026-03-10`
([GitHub REST documentation](https://docs.github.com/en/rest)).
GitLab uses project-scoped REST reads
([GitLab projects API](https://docs.gitlab.com/api/projects/)). Figma uses
`GET /v1/files/:key/meta` with `file_metadata:read`, never the full document tree
([Figma file endpoints](https://developers.figma.com/docs/rest-api/file-endpoints/)).
Saving a token records it; resource access is checked when each preview loads.
Disconnecting forgets the local token. Revoke the original token at the provider
when it should no longer work outside Docmost.

## Document behavior

Pasting a supported HTTPS link offers **Link**, **Mention** and **Card** when
previews are enabled. Otherwise it inserts an ordinary link. Cancel also inserts
the ordinary link. A selection bookmark follows intervening collaborative
transactions. Plain-text paste retains its existing behavior.

Both new nodes, `integrationPreview` and `integrationMention`, store only their
canonical `url`. Tracking and credential query parameters are discarded;
supported Figma node IDs and bounded fragments are retained. There are no stored
titles, descriptions, thumbnails or credentials in the document. Fetched strings
are React text, never interpreted as HTML. Local find matches a URL as one whole
node; text replacement preserves these nodes.

Each authenticated viewer resolves metadata using their own connection and
current page read access. Public documents show only the original link, including
when the reader is logged in. Presentation remains read-only. Server readers,
collaboration and client schemas understand both nodes before creation is used.
Copy, undo/redo, HTML and portable archives preserve URLs. Markdown, PDF, DOCX,
search, AI and RAG receive the original URL, not private provider metadata.
Disabling previews preserves existing nodes and saved personal connections.

## Request and credential boundaries

The transport accepts only fixed SaaS hosts and corresponding read endpoints;
it rejects userinfo, alternate ports, arbitrary paths and endpoint injection.
The independent deployment allowlist is mandatory even in development. DNS
addresses are validated and pinned; loopback targets are rejected. Redirects are
never followed. Each provider receives only its own authentication header.
No remote thumbnail or embedded resource is fetched.

Tokens are AES-GCM encrypted with keys derived from `APP_SECRET` and the
workspace/user/connection identity. Connection APIs return metadata only.
Replacing a token increments its revision; another viewer cannot decrypt copied
ciphertext. Follow the ordinary application secret backup/recovery procedures.
There is no new plaintext credential file.

Metadata is bounded to 1 MiB after decompression. HTTP reads have a seven-second
deadline after DNS resolution. At most eight provider reads per user and 32 per
process run concurrently; no unbounded queue is kept. Resolve requests also use
the Redis auth throttle (60 per session and 120 per IP per minute). These process
limits are not a cluster-wide concurrency guarantee.

The in-memory result cache has 256 entries and a 60-second lifetime, keyed by
workspace, viewer, connection ID/revision and URL. Private cache hits always
revalidate provider authorization, optionally with ETag. Provider failures never
fall back to a stale private title. Page access, workspace enablement and
connection revision are checked again before returning a result. Browser
responses use `Cache-Control: no-store`; saved credentials are removed from the
mutation cache.

## Storage and verification

Migration `20261031T150000-integration-link-previews.ts` creates settings and
personal connection tables. Existing workspaces stay disabled. Downgrade refuses
to discard stored credentials; use the enable switch for normal rollback.

Targeted server tests use real loopback HTTP for transport bounds and separate
authorization/cache race tests. `node apps/client/e2e/integration-previews/run.mjs`
owns Vite on port 5205 and checks Chromium, Firefox and WebKit in desktop/light
and mobile/dark configurations. The database live runner includes real
PostgreSQL/API connection, encryption, page-access and node persistence checks.
Its explicit test-only preload supplies synthetic provider metadata, without
private provider access or real credentials. Transport tests remain independent
of that preload. `--integration-previews-only --api-only` is a diagnostic subset
and does not replace complete database/release acceptance.
