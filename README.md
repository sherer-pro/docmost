[Russian version of Fork-Specific Enhancements](./FORK_SPECIFIC_ENHANCEMENTS_RU.md)

> [!NOTE]
> This is a custom fork of Docmost that I created to simplify team collaboration and better structure the knowledge base. My goal was to make the system more predictable, secure, and practical for real-world use — without unnecessary complexity and with the ability to evolve faster using AI agents. I have great respect for the Docmost team and the work they’ve done. However, their focus on releasing features primarily for commercial use does not resonate with me, so I decided to develop my own fork — with an emphasis on openness, practicality, and independence.

---

# Fork-Specific Enhancements

The fork transforms Docmost from a primarily wiki-oriented system into a platform for managing corporate knowledge, structured data, and document workflows.

Its key differences include a built-in AI assistant for each space, RAG and Open WebUI synchronization, Notion-style databases, extended document properties, a terminology dictionary, a more capable editor, portable archives, push notifications, and a stricter security model.

> [!IMPORTANT]
> **The entire Enterprise Edition application layer has been removed.** The fork has no separate EE runtime modules, imports, license enforcement, billing integration, or enterprise code tree. Former EE user-facing capabilities—including SSO, MFA, comments, advanced search, and sharing controls—are implemented directly in the AGPL 3.0 core. Historical database migrations retain some legacy schema names only to remove obsolete EE data during upgrades.

### 1. Built-in AI assistant for each space

The fork includes its own AI assistant, configured separately for each space:

- connection to private and local OpenAI-compatible models;

- persistent private chats with history;

- space-level system instructions;

- optional space-owned assistant profiles with frozen instructions, exact tool
  allowlists, group visibility, preferred/default selection, and verified model
  overrides;

- built-in and custom quick commands;

- model, temperature, context window, timeout, and limit settings;

- daily limits on user requests and space token usage;

- image support for compatible models;

- optional display of reasoning text returned by the model;

- model connection testing from the administration interface;

- a unified, responsive Markdown composer with visible context, space-search, and Chat/Agent controls, Enter-to-send keyboard behavior, and an auto-saving context manager that groups the current document, space sources, private files, and attachments in one flow.


The previous legacy editor text-generation workflow has been removed and replaced with a unified assistant integrated into the core version of the fork.

![AI assistant with document context and Markdown composer](./docs/images/fork-specific-enhancements/en/ai-assistant-context.png)

### 2. Context-aware AI workflows inside documents

The assistant can work not only with a user-entered message, but also with Docmost context:

- the current document;

- selected text;

- selected pages;

- databases and their rows;

- attachments from the current document;

- files uploaded directly to a private chat;

- space search results.


For selected text, actions include shortening, explaining, improving, correcting grammar, continuing, translating, and changing the tone.

AI output can be:

- used to replace the selected text;

- inserted below the selection;

- inserted at the current cursor position;

- regenerated;

- copied;

- reviewed together with the sources used.


The assistant also supports draft persistence, automatic chat titles, search across chats and commands, background AI activity indicators, and streamed generation.

The context manager uses one responsive dialog for overview, space search, child-page scope, and explicit descendant selection instead of stacking menus and nested dialogs.

The composer presents input and settings as one focus-aware card: context and search stay directly available, Chat/Agent mode uses a compact segment, and templates, Markdown tools, status, and send/stop actions remain in a stable footer. On narrow panels, secondary labels collapse without introducing horizontal scrolling.

Assistant profiles are deployment- and workspace-gated. Selecting a profile
does not send a message; an optional Start action can send a visible launch
message through the ordinary chat flow. Profile display name/version and
behavior snapshots remain stable in history, while live ACL and tool-policy
revocation still fail closed. Existing spaces and no-profile conversations keep
their previous behavior.

Agent mode is an optional per-conversation workflow. It can search and navigate
accessible Docmost content, then propose bounded edits to the current page.
Every write requires a separate initiator-only confirmation and is rejected if
the page content, write permission, or built-in tool policy changed before
approval. The shared built-in tool catalog is controlled by exact workspace and
space capability allowlists; optional context, database, table, comment,
history, transclusion, attachment-metadata, and public-share reads are off at
the deployment boundary by default and require explicit opt-in.

![Per-space assistant and agent mode settings](./docs/images/fork-specific-enhancements/en/ai-agent-settings.png)

### 3. RAG and Open WebUI integration

The fork includes its own RAG API and integrations with external knowledge-retrieval systems.

Supported capabilities include:

- APIs for full and incremental synchronization of pages, databases, rows, and attachments;

- API keys restricted to a specific space;

- a custom HTTP JSON retrieval adapter;

- direct integration with Open WebUI Knowledge Base;

- built-in per-space synchronization from Docmost to Open WebUI Knowledge Base;

- tracking of created, updated, and deleted content;

- attachment synchronization;

- Knowledge Base availability checks;

- filtering and revalidation of access permissions for retrieved sources;

- removal of embedded-sync files after AI content-policy changes, with page ACLs revalidated independently when retrieval results are used;

- SQL-backed cursor pagination and opaque deletion feeds;

- deduplication of contextual search results;

- separate RAG and MCP key types managed from one API keys page with dedicated tabs and onboarding presets;

- a shared content-exclusion policy applied to retrieval, synchronization, agent tools, and MCP results;

- a stateless read-only MCP endpoint for external assistants, using the same
  access-aware tool registry and exact capability policy as agent mode.


This allows Docmost content to serve as an up-to-date knowledge base for local
or corporate LLMs. RAG and MCP keys are scoped to one space, are not
interchangeable, and are revalidated on every request against the creator's
current membership and page access. Existing MCP keys retain only the seven
baseline reads; optional reads must be selected explicitly for each key.

#### Outbound external MCP servers

The fork also supports the opposite direction: the internal agent can call
read-only tools on remote MCP servers. Docmost is the MCP client here, and this
surface shares no configuration or credentials with the inbound endpoint above.

Access requires every level to agree, and each one defaults to closed:

- a deployment kill switch (`AI_EXTERNAL_MCP_ENABLED`, off by default);
- a workspace master switch;
- the server being enabled, which is impossible until tools are approved;
- a space binding;
- no group denial;
- an explicit per-user opt-in, shown with a warning naming the destination.

A lower scope can only narrow a higher one. A workspace allowlist entry is
rejected unless the deployment allowlist already contains that origin, and a
space can only pick from what the workspace approved.

Everything a remote server says about itself is treated as hostile input. Remote
titles and descriptions are not stored at all, only the fact that they exist;
`readOnlyHint` and the other annotations are shown as claims and never decide the
read/write class; and JSON Schemas are rebuilt from an allowlist of structural
keywords, with remote property names replaced by opaque aliases and prose-bearing
keywords and string values dropped. The server-side mapping restores argument
names only at the RPC boundary. The only text about a tool that the model ever
sees is the description a workspace administrator typed. Results are
wrapped in an envelope marked untrusted, and the fixed Docmost safety policy is
stated before the external-tool rules, with space hints last and explicitly
non-overriding.

Other properties:

- read-only only, enforced both by the contract type and by a database check
  constraint, so an external tool can never propose a page change;
- per-server request headers encrypted with the application secret and never
  returned by any endpoint, only a boolean and, for workspace administrators, the
  header names;
- Streamable HTTP only, with a dual origin allowlist, DNS pinning, manual
  redirect handling, and a streaming response size cap;
- every agent run carries a versioned capability snapshot that is re-verified
  before each call, so revoking access or changing configuration stops a run in
  flight rather than widening it;
- an operational summary that records outcomes and latencies but no identifier,
  address, argument, or output.

Agent and MCP tool architecture adapted from [vvzvlad/gitmost](https://github.com/vvzvlad/gitmost) and [vvzvlad/docmost-mcp](https://github.com/vvzvlad/docmost-mcp). Special thanks to [@vvzvlad](https://github.com/vvzvlad) for developing and maintaining the fork, and to Moritz Krause, the original author of `docmost-mcp`.

![RAG synchronization and MCP access](./docs/images/fork-specific-enhancements/en/rag-mcp-access.png)

### 4. Reliable AI request infrastructure

AI features are implemented as a separate server-side subsystem:

- a dedicated processing queue;

- persistent storage of chats, messages, and runs;

- immutable generation attempts;

- idempotent message submission, retries, and file uploads;

- regeneration without corrupting chat history;

- task recovery when PostgreSQL and Redis become desynchronized;

- concurrent-run limits;

- up to six parallel provider requests per user;

- waiting agent approvals do not consume those provider slots and have a separate bounded queue;

- separate per-approval and whole-run budgets for agent model steps and tool calls;

- safe recovery of decided agent proposals after worker or queue interruption;

- token and quota controls;

- cancellation of an active response;

- protection against rerunning an already completed request;

- source snapshots preserved for each generation;

- hiding responses when access to the source material has been lost.

![AI request limits and retention controls](./docs/images/fork-specific-enhancements/en/ai-request-infrastructure.png)


### 5. Notion-style databases

The fork includes structured databases:

- database rows are full pages;

- typed properties;

- filtering and sorting;

- column reordering;

- row and cell editing;

- actions for individual and selected rows;

- database properties displayed on the row page;

- tree-based navigation through rows and subpages;

- conversion of a regular page into a database and a database into a page;

- database change history;

- administrator-only deletion of individual history versions;

- correct copying and duplication of structures together with attachments.

![Database page and table controls](./docs/images/fork-specific-enhancements/en/database.png)


### 6. Extended document properties

Pages and database rows include configurable fields:

- status;

- assignee;

- stakeholders;

- AI role;

- estimated reading time.


The set of visible fields is configured separately for each space.

The AI role field indicates how AI participated in creating the document:

- `None`;

- `Editor`;

- `Coauthor`;

- `Coauthor+`;

- `Author`.


Changes to significant properties are recorded in the document history.

![Notion-style database and document fields](./docs/images/fork-specific-enhancements/en/database-document-fields.png)

### 7. Tags and terminology dictionary

The fork provides more advanced terminology management:

- page tags;

- scoped labels;

- a registry of allowed workspace tags;

- tag descriptions shown on hover;

- a terminology dictionary;

- word forms and term variants;

- automatic highlighting of terms in documents;

- JSON dictionary import and export.

![Space terminology dictionary](./docs/images/fork-specific-enhancements/en/dictionary.png)


### 8. Search and content indexing

Search works across pages, databases, rows, and attachments while preserving current workspace, space, public-sharing, and page-level access rules:

- PostgreSQL full-text search is available by default;

- Typesense can be selected as a scalable candidate index;

- PDF and DOCX names and extracted text are searchable;

- search filters cover spaces, content types, page labels, and inline TBD/TODO tags;

- result breadcrumbs show where a page or database row sits in the content tree;

- extraction has bounded byte, page, archive-entry, text-size, and wall-clock budgets;

- indexing status distinguishes pending, processing, ready, skipped, and failed files;

- abandoned work is reconciled after restart, while permanently unreadable files are not retried forever;

- indexed candidates are always reloaded from PostgreSQL and rechecked against live access policy before being returned.

![Search filters and result breadcrumbs](./docs/images/fork-specific-enhancements/en/search-indexing.png)


### 9. Extended editor

The editor includes the following additional capabilities:

- a fixed toolbar;

- indentation;

- page breaks;

- automatic heading numbering;

- personal numbering preferences;

- embedded PDF viewing;

- full-size image previews;

- width settings for individual blocks;

- improved table rendering;

- consistent default table widths and paste behavior;

- improved Draw.io, Excalidraw, and Mermaid diagrams;

- a subpage navigation block;

- rich link previews;

- transclusion of one document inside another;

- synced blocks created from selected document fragments, with reference lookup and safe unsyncing;

- audio file upload and playback;

- alternative text for images and media.

![Extended editor, tables, and navigation](./docs/images/fork-specific-enhancements/en/extended-editor.png)


### 10. Import, export, and data portability

The export system for pages, spaces, and databases has been redesigned:

- Markdown;

- HTML;

- PDF;

- export of the current database view with its filters, sorting, and visible columns;

- export of child pages;

- export of attachments;

- more accurate PDF rendering of tables, diagrams, and system blocks.


A custom portable Docmost archive format has also been added:

- export of pages, spaces, and databases;

- preservation of structure, properties, and attachments;

- import preview;

- import confirmation or cancellation;

- operation reports;

- protection against corrupted and excessively large ZIP archives.

![Import and export options](./docs/images/fork-specific-enhancements/en/import-export.png)


### 11. Comments and collaboration

The collaboration system has been extended with:

- page-level comments;

- inline comments;

- comment replies;

- resolving and reopening discussions;

- separate views for open and resolved comments;

- hiding resolved discussions;

- automatic collapsing of long comments and reply threads;

- copying a page to Markdown together with open and resolved comments and their document locations;

- indicators showing users who are viewing or editing a document;

- real-time user presence;

- more reliable page-tree synchronization.

![Comments, presence, and collaboration](./docs/images/fork-specific-enhancements/en/collaboration.png)


### 12. Notifications

An extended notification system has been added:

- in-app notifications;

- browser push notifications;

- mentions;

- comments and replies;

- assignee changes;

- stakeholder additions;

- significant document updates;

- immediate or aggregated delivery;

- configurable delivery intervals;

- the ability to disable email notifications;

- suppression of notifications already read by the user;

- recipient access checks for the document.

![Push and email notification preferences](./docs/images/fork-specific-enhancements/en/notifications.png)


### 13. Access control

The fork provides stricter permission management:

- users can see only members with whom they share groups or spaces;

- the system `Everyone` group is hidden from regular members;

- access restrictions can be defined for individual pages;

- page permissions apply to database rows, search, export, and RAG;

- a restricted page is excluded together with its entire descendant tree;

- workspace settings are available only to administrators;

- space AI settings are available only to space or workspace administrators;

- an API key cannot grant more permissions than its creator has;

- API key access is revalidated on every request;

- public sharing can be disabled for the entire workspace or for an individual space;

- public pages, public search, and public attachments recheck the current sharing policy;

- OIDC, SAML, and LDAP group synchronization follows only mappings explicitly created by an administrator.

![Page access control for users and groups](./docs/images/fork-specific-enhancements/en/access-control.png)


### 14. Security

Additional protection mechanisms include:

- TOTP-based two-factor authentication;

- backup codes;

- active user session management;

- revocation of one or all sessions;

- mandatory binding of JWTs to an active session;

- binding of collaboration tokens to the issuing session;

- CSRF protection;

- validation of allowed hosts and origins;

- rate limiting for authentication routes;

- hashing of password-reset tokens;

- secure Mermaid processing;

- allowlists for iframes and external resources;

- SSRF protection when connecting AI and RAG providers;

- DNS-pinned outbound AI/RAG connections after allowlist validation;

- Redis-backed per-key rate and concurrency limits for RAG and MCP;

- bounded PDF and DOCX parsing for private AI files;

- page-tree depth limits;

- protection against cyclic page moves;

- decompression limits and CRC validation for ZIP archives;

- resource filtering during PDF export;

- stricter validation of WebSocket rooms and messages;

- core OIDC Authorization Code flow with PKCE, state, and nonce;

- signed SAML responses bound to stored login requests;

- LDAP service and user binds with escaped filters and bounded searches;

- encrypted and redacted SSO credentials plus an explicit endpoint allowlist;

- provider verification before it is offered for sign-in, and a successful real login before SSO can be enforced;

- explicit administrator-managed SSO group mappings that never create arbitrary workspace groups.

![Security, sharing controls, MFA, and SSO](./docs/images/fork-specific-enhancements/en/security-sso.png)


### 15. PWA, interface, and navigation

The fork can be installed as a Progressive Web App:

- a custom Service Worker;

- application shell caching;

- limited offline functionality;

- a dedicated offline page;

- automatic client-version updates.


It also adds:

- responsive tables and settings;

- improved mobile layouts;

- accessibility improvements;

- per-page Edit/Read mode and full-width preferences;

- optional restoration of the last scroll position;

- persistence of page-tree state;

- expansion of the entire tree;

- custom links with icons in the space sidebar;

- favorites for pages and spaces;

- space archiving and unarchiving, with archived content kept read-only;

- more consistent placement of controls.

![Home navigation and recently updated pages](./docs/images/fork-specific-enhancements/en/pwa-navigation.png)


### 16. Operations and development

The fork includes its own maintenance and development infrastructure:

- one Docker build for the application and its built-in RAG Sync runtime;

- CI workflows;

- automated container publishing;

- environment variable validation;

- quick and full composite verification pipelines;

- API route inventory generation;

- automated checks for RAG documentation drift and removed Enterprise Edition runtime remnants;

- security tests;

- architecture audits;

- circular dependency detection;

- duplicate and unused code detection;

- architecture documentation;

- an `AGENTS.md` file for AI agents working with the repository;

- console-only recovery commands for rebuilding the search index and disabling broken SSO enforcement;

- Graphify support.

![Repository verification and recovery toolchain](./docs/images/fork-specific-enhancements/en/operations-development.svg)

---

# Docmost

Open-source collaborative wiki and documentation software.

- [Website](https://docmost.com)
- [Documentation](https://docmost.com/docs)
- [Twitter](https://twitter.com/DocmostHQ)

## Getting started

The upstream [Docmost documentation](https://docmost.com/docs) remains the
product baseline. This fork's local files are authoritative for its added
AI/RAG/MCP behavior and deployment variables.

Host development:

```bash
cp .env.example .env
# Set APP_SECRET, DATABASE_URL, and REDIS_URL in .env.
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Docker Compose:

```bash
cp .env.compose.example .env
# Replace REPLACE_WITH_LONG_SECRET and STRONG_DB_PASSWORD in .env.
docker compose up -d --build
```

For the Ubuntu layout where `/opt/edge-proxy` already owns the external
`edge` network, set `EDGE_NETWORK_NAME=edge` and
`EDGE_NETWORK_EXTERNAL=true` in `/opt/docmost/.env`. The proxy and Drawio
Compose files do not need changes. Local Compose keeps the defaults and creates
its own `docmost_edge` network.

Open WebUI synchronization runs inside the main Docmost process. Enable the
deployment boundary and approve the exact Open WebUI origin in the same root
`.env` used by Docmost:

```dotenv
RAG_SYNC_ENABLED=true
RAG_SYNC_ALLOWED_ORIGINS=https://open-webui.example.com
```

Then configure the pre-created Knowledge Base and its writer API key in each
space's AI settings. Writer credentials are encrypted in PostgreSQL and are not
placed in Compose or Docker metadata. Query-time retrieval remains a separate
per-space setting with its own credential. One Knowledge Base can be claimed by
only one space. A normal disable drains Docmost-managed files and keeps the
configured target reserved for that space; force disable is available when the
remote service is unavailable.

The ordinary `docker compose up -d --build` command starts the complete local
stack. There is no `rag-sync` profile or second image. Redis is shared with the
backend through a versioned `RAG_SYNC_REDIS_PREFIX` namespace.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for system boundaries,
[`docs/AI_ASSISTANT_AND_RAG.md`](./docs/AI_ASSISTANT_AND_RAG.md) for the
canonical AI/RAG/MCP architecture and recovery guide,
[`docs/AI_INTEGRATION.md`](./docs/AI_INTEGRATION.md) for operator setup, and
[`docs/RAG_API.md`](./docs/RAG_API.md) for the external synchronization API.

## Features

- Real-time collaboration
- Diagrams (Draw.io, Excalidraw and Mermaid)
- Spaces
- Permissions management
- Groups
- Comments
- Page history
- Search
- File attachments
- Embeds (Airtable, Loom, Miro and more)
- Translations (10+ languages)

### Screenshots

<p>
<img alt="home" src="https://docmost.com/screenshots/home.png" width="70%">
<img alt="editor" src="https://docmost.com/screenshots/editor.png" width="70%">
</p>

### License

This repository is licensed under the open-source AGPL 3.0 license.

### Contributing

See the [development documentation](https://docmost.com/docs/self-hosting/development)


## Test toolchain version matrix

Validated backend coverage stack (Node 22) used in this repository:

| Component | Version | Notes |
| --- | --- | --- |
| Node.js | 22.x | Runtime baseline for local/dev and container builds. |
| Jest | 30.2.0 | Main test runner for backend unit/integration tests. |
| ts-jest | 29.4.6 | Single TypeScript transformer for backend Jest config. |
| babel-jest | 30.2.0 | Version pinned at workspace level to avoid accidental mismatches. |
| test-exclude | 6.0.0 | Coverage include/exclude helper used in Jest/Istanbul ecosystem. |
| coverageProvider | v8 | Native Node V8 coverage provider (no Babel Istanbul transform). |

Backend smoke command for early coverage regressions:

```bash
pnpm --filter ./apps/server test:cov:smoke
```

## Local quality-check checklist

Run these commands before opening a PR:

```bash
pnpm install --frozen-lockfile
pnpm verify:quick
```

Before release candidates or broad architecture changes, run:

```bash
pnpm verify:full
pnpm routes:inventory:check
pnpm check:rag-docs
pnpm check:env
pnpm check:comments:en
```

For backend changes:

```bash
pnpm --filter ./apps/server lint
pnpm --filter ./apps/server test
pnpm --filter ./apps/server test:alias:smoke
```

For frontend changes:

```bash
pnpm --filter ./apps/client lint
pnpm --filter ./apps/client test
```

For comment-language validation (required):

```bash
pnpm check:comments:en
```

Runtime/tooling baseline used in this repository:

- Node.js 22.x
- pnpm 10.4.0

## Thanks
Special thanks to;

<img width="100" alt="Crowdin" src="https://github.com/user-attachments/assets/a6c3d352-e41b-448d-b6cd-3fbca3109f07" />

[Crowdin](https://crowdin.com/) for providing access to their localization platform.


<img width="48" alt="Algolia-mark-square-white" src="https://github.com/user-attachments/assets/6ccad04a-9589-4965-b6a1-d5cb1f4f9e94" />

[Algolia](https://www.algolia.com/) for providing full-text search to the docs.
