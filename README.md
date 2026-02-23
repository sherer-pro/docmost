> [!NOTE]
> This is a custom fork of Docmost that I created to simplify team collaboration and better structure the knowledge base. My goal was to make the system more predictable, secure, and practical for real-world use — without unnecessary complexity and with the ability to evolve faster using AI agents. I have great respect for the Docmost team and the work they’ve done. However, their focus on releasing features primarily for commercial use does not resonate with me, so I decided to develop my own fork — with an emphasis on openness, practicality, and independence.

 ---

# Fork-Specific Enhancements

## PWA / Offline

- Added full Progressive Web App support with limited offline functionality.

## Editor & Attachments

- PDF attachments: added display modes (as a file or as an embedded block) + a UI toggle.
- Clicking images in the editor opens the full-size preview.

## Comments

- Added the ability to mark comments as resolved.
- Added the ability to hide/show resolved comments.

## Member Visibility Restrictions

- Users can only see members who share groups and spaces with them.

## MFA / 2FA

- Added two-factor authentication via TOTP.

## Documents & Settings

- Added custom document fields: status, owner, stakeholders.
- Added space-level configuration for displaying custom fields.

## Admin

- Added the ability to deactivate and reactivate a user.

## Security

- CSRF protection (service/guard, cookie handling, axios v1 header compatibility).
- Switched some requests to `GET` (e.g., `users/me`, `collab-token`) to reduce CSRF risk.
- Hardened WebSocket security (payload validation, relay isolation, tests).
- Server-side Mermaid sanitization.
- Rate limiting for auth endpoints.

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

<p align="center">
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

Run these commands before opening a PR for backend changes:

```bash
pnpm --filter ./apps/server lint
pnpm --filter ./apps/server test
pnpm --filter ./apps/server test:alias:smoke
```

## Thanks
Special thanks to;

<img width="100" alt="Crowdin" src="https://github.com/user-attachments/assets/a6c3d352-e41b-448d-b6cd-3fbca3109f07" />

[Crowdin](https://crowdin.com/) for providing access to their localization platform.


<img width="48" alt="Algolia-mark-square-white" src="https://github.com/user-attachments/assets/6ccad04a-9589-4965-b6a1-d5cb1f4f9e94" />

[Algolia](https://www.algolia.com/) for providing full-text search to the docs.

