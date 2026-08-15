# Outbound external MCP audit

This audit is intentionally separate from `verify:release`: it is a
mutation-heavy Docker acceptance run for the outbound external-MCP boundary.
The mandatory fast hostile-server contract is already part of
`pnpm test:security`.

Prerequisites:

- a healthy local Compose runtime on `http://localhost:3000`;
- Docker access to the `docmost_default` network and the standard Compose
  container names, or explicit `DOCMOST_AI_MCP_*`/`DOCMOST_*_CONTAINER_NAME`
  overrides;
- Playwright Chromium and the repository dependencies installed;
- either `DOCMOST_AUTH_TOKEN` plus `DOCMOST_CSRF_TOKEN`, or
  `DOCMOST_ADMIN_EMAIL` plus `DOCMOST_ADMIN_PASSWORD` supplied only to the
  process.

Run from the repository root:

```sh
corepack pnpm test:ai-external-mcp:e2e
```

The runner creates isolated hostile/reference/model containers, temporary MCP
servers, a space, a group, invitations, and a member. It temporarily changes
workspace MCP configuration and force-recreates the application container to
exercise the deployment kill switch. Cleanup restores the original application
environment and workspace settings, deletes synthetic records, and removes the
temporary containers even after a failed scenario. Audit artifacts are written
under ignored `output/audit/ai-external-mcp-*` directories and are scanned for
runtime credentials before completion.

For the fast lower-level contract only, without live mutation, set
`DOCMOST_AI_MCP_E2E_SKIP_LIVE=1`. A remote implementation can still lie about
its side effects; the protocol metadata cannot prove that an approved remote
tool is operationally read-only.
