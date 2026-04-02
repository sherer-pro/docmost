> [!NOTE]
> This is a custom fork of Docmost that I created to simplify team collaboration and better structure the knowledge base. My goal was to make the system more predictable, secure, and practical for real-world use — without unnecessary complexity and with the ability to evolve faster using AI agents. I have great respect for the Docmost team and the work they’ve done. However, their focus on releasing features primarily for commercial use does not resonate with me, so I decided to develop my own fork — with an emphasis on openness, practicality, and independence.

 ---

# Fork-Specific Enhancements

## Databases (Notion-like)

- Added databases: row/column actions, deletion, filters, and sorting.
- Added Markdown export for the current table view (respects visible columns/filters/sorting).
- Added conversion between databases and pages (both directions).
- Added database change history support.
- The page and database export system has been fully redesigned: Markdown, HTML, and PDF are now supported.
- PDF export has been significantly improved: diagrams, attachments, and system blocks are rendered more accurately.
- Database exports now include options to include attachments and child pages.

## RAG/AI

- Added core RAG API (`/api/rag/*`) authenticated exclusively via space-scoped API keys (Bearer): full/delta sync and exports for pages/databases/rows/attachments/comments.
- Implemented API key management (CRUD, required `spaceId`, soft revoke, `expiresAt/lastUsedAt`) plus admin/owner UI; key creation now requires selecting a space, defaulting to “No expiration”.
- Added `RAG_API.md` with a full spec and integration examples.


## PWA / Offline

- Added full Progressive Web App support with limited offline functionality.

## Editor & Attachments

- PDF attachments: added display modes (as a file or as an embedded block) + a UI toggle.
- Clicking images in the editor opens the full-size preview.

## Comments

- Added the ability to mark comments as resolved.
- Added the ability to hide/show resolved comments.
- The commenting system has been improved: page-level comments were added, and filters and reply handling were fixed.

## Member Visibility Restrictions

- Users can only see members who share groups and spaces with them.
- The page-level ACL has been implemented.

## MFA / 2FA

- Added two-factor authentication via TOTP.

## Documents & Settings

- Added custom document fields: status, owner, stakeholders.
- Added space-level configuration for displaying custom fields.
- If the “Status” custom field is enabled in a space, the sidebar shows the corresponding indicator.
- Changes to the “Status”, “Owner”, and “Stakeholder” custom fields are recorded in the page history.
- Added display of participants viewing or editing a document.
- Added rich link previews when inserting links.
- Added the ability to cite a selected fragment in another document.
- The "full width" page setting can now be applied per page.

## Notifications

- Notifications are created for mentions, comments, assignments, and important updates.
- They appear instantly in the interface and are visible only to users with access.
- Users can view the list, see the unread count, and mark notifications as read.
- Push notifications can be enabled: receive them instantly or as a digest.
- Ability to disable email notifications.

## Admin

- Added the ability to deactivate and reactivate a user.

## Security

- CSRF protection (service/guard, cookie handling, axios v1 header compatibility).
- Switched some requests to `GET` (e.g., `users/me`, `collab-token`) to reduce CSRF risk.
- Hardened WebSocket security (payload validation, relay isolation, tests).
- Rate limiting for auth endpoints.
- Added hashing for password reset tokens (no plaintext stored in the DB). 
- Added server-side Mermaid sanitization.
- Tightened CSP.

## Dev/Docs

- Created `AGENTS.md` to simplify AI-assisted work (runbook/rules/environment variables).
- Updated test/package infrastructure (Jest aliasing, package overrides/patches).

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
Docmost core is licensed under the open-source AGPL 3.0 license.  
Enterprise features are available under an enterprise license (Enterprise Edition).  

All files in the following directories are licensed under the Docmost Enterprise license defined in `packages/ee/License`.
  - apps/server/src/ee
  - apps/client/src/ee
  - packages/ee

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
pnpm build
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
