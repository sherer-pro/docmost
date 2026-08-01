> [!NOTE]
> This is a custom fork of Docmost that I created to simplify team collaboration and better structure the knowledge base. My goal was to make the system more predictable, secure, and practical for real-world use — without unnecessary complexity and with the ability to evolve faster using AI agents. I have great respect for the Docmost team and the work they’ve done. However, their focus on releasing features primarily for commercial use does not resonate with me, so I decided to develop my own fork — with an emphasis on openness, practicality, and independence.

---

# Fork-Specific Enhancements

The fork transforms Docmost from a primarily wiki-oriented system into a platform for managing corporate knowledge, structured data, and document workflows.

Its key differences include a built-in AI assistant for each space, RAG and Open WebUI synchronization, Notion-style databases, extended document properties, a terminology dictionary, a more capable editor, portable archives, push notifications, and a stricter security model.

### 1. Built-in AI assistant for each space

The fork includes its own AI assistant, configured separately for each space:

- connection to private and local OpenAI-compatible models;

- persistent private chats with history;

- space-level system instructions;

- built-in and custom quick commands;

- model, temperature, context window, timeout, and limit settings;

- daily limits on user requests and space token usage;

- image support for compatible models;

- optional display of reasoning text returned by the model;

- model connection testing from the administration interface.


The previous legacy editor text-generation workflow has been removed and replaced with a unified assistant integrated into the core version of the fork.

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

### 3. RAG and Open WebUI integration

The fork includes its own RAG API and integrations with external knowledge-retrieval systems.

Supported capabilities include:

- APIs for full and incremental synchronization of pages, databases, rows, and attachments;

- API keys restricted to a specific space;

- a custom HTTP JSON retrieval adapter;

- direct integration with Open WebUI Knowledge Base;

- a dedicated `rag-sync` worker for synchronizing Docmost with Open WebUI;

- tracking of created, updated, and deleted content;

- attachment synchronization;

- Knowledge Base availability checks;

- filtering and revalidation of access permissions for retrieved sources;

- deduplication of contextual search results.


This allows Docmost content to serve as an up-to-date knowledge base for local or corporate LLMs.

The same access-aware tool layer now powers an optional agent mode in private AI chats and a stateless, read-only MCP endpoint for external assistants. Agent writes are limited to safe operations on the current page and require a separate confirmation from the initiating user.

Agent and MCP tool architecture adapted from [vvzvlad/gitmost](https://github.com/vvzvlad/gitmost) and [vvzvlad/docmost-mcp](https://github.com/vvzvlad/docmost-mcp). Special thanks to [@vvzvlad](https://github.com/vvzvlad) for developing and maintaining the fork, and to Moritz Krause, the original author of `docmost-mcp`.

### 4. Reliable AI request infrastructure

AI features are implemented as a separate server-side subsystem:

- a dedicated processing queue;

- persistent storage of chats, messages, and runs;

- immutable generation attempts;

- idempotent message submission, retries, and file uploads;

- regeneration without corrupting chat history;

- task recovery when PostgreSQL and Redis become desynchronized;

- concurrent-run limits;

- up to five parallel requests per user;

- token and quota controls;

- cancellation of an active response;

- protection against rerunning an already completed request;

- source snapshots preserved for each generation;

- hiding responses when access to the source material has been lost.


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

- correct copying and duplication of structures together with attachments.


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


### 8. Extended editor

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

- improved Draw.io, Excalidraw, and Mermaid diagrams;

- a subpage navigation block;

- rich link previews;

- transclusion of one document inside another;

- quotation of a selected document fragment;

- audio file upload and playback;

- alternative text for images and media.


### 9. Import, export, and data portability

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


### 10. Comments and collaboration

The collaboration system has been extended with:

- page-level comments;

- inline comments;

- comment replies;

- resolving and reopening discussions;

- separate views for open and resolved comments;

- hiding resolved discussions;

- indicators showing users who are viewing or editing a document;

- real-time user presence;

- more reliable page-tree synchronization.


### 11. Notifications

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


### 12. Access control

The fork provides stricter permission management:

- users can see only members with whom they share groups or spaces;

- the system `Everyone` group is hidden from regular members;

- access restrictions can be defined for individual pages;

- page permissions apply to database rows, search, export, and RAG;

- a restricted page is excluded together with its entire descendant tree;

- workspace settings are available only to administrators;

- space AI settings are available only to space or workspace administrators;

- an API key cannot grant more permissions than its creator has;

- API key access is revalidated on every request.


### 13. Security

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

- page-tree depth limits;

- protection against cyclic page moves;

- decompression limits and CRC validation for ZIP archives;

- resource filtering during PDF export;

- stricter validation of WebSocket rooms and messages.


### 14. PWA, interface, and navigation

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

- persistence of page-tree state;

- expansion of the entire tree;

- custom links with icons in the space sidebar;

- more consistent placement of controls.


### 15. Operations and development

The fork includes its own maintenance and development infrastructure:

- Docker builds for the application and the RAG worker;

- CI workflows;

- automated container publishing;

- environment variable validation;

- API route inventory generation;

- security tests;

- architecture audits;

- circular dependency detection;

- duplicate and unused code detection;

- architecture documentation;

- an `AGENTS.md` file for AI agents working with the repository;

- Graphify support.

---

# Docmost

Open-source collaborative wiki and documentation software.

- [Website](https://docmost.com)
- [Documentation](https://docmost.com/docs)
- [Twitter](https://twitter.com/DocmostHQ)

## Getting started

To get started with Docmost, please refer to our [documentation](https://docmost.com/docs).

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
