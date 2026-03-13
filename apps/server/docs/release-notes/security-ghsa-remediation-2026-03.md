# Security Remediation Release Notes (2026-03)

This release consolidates fixes and regression coverage for the following advisories:

- `GHSA-h7fp-4f37-29wq` (share SEO XSS)
- `GHSA-r4hj-mc62-jmwj` (Mermaid SVG XSS)
- `GHSA-54pm-hqxm-54wg` (ZIP path traversal)
- `GHSA-qvxv-4pj5-64xq` (generic iframe/embed XSS)

## Affected and fixed versions

- `GHSA-h7fp-4f37-29wq`: affected `<=0.25.2`, fixed in `0.26.0`.
- `GHSA-r4hj-mc62-jmwj`: affected `<=0.25.2`, fixed in `0.26.0`.
- `GHSA-54pm-hqxm-54wg`: affected `>0.21.0`, fixed in `0.24.0`.
- `GHSA-qvxv-4pj5-64xq`: affected `<=0.27.0`, fixed in `0.28.0`.

## Recommended remediation

1. Upgrade all deployments to `>=0.29.0`.
2. If upgrade is blocked, apply targeted backports:
   - `0.22-0.23`: ZIP fix + share/Mermaid/embed XSS fixes.
   - `0.24-0.25.2`: share/Mermaid/embed XSS fixes.
   - `0.26-0.27.x`: embed XSS fix.
3. Validate each patched environment with:
   - `pnpm test:security`
   - manual PoC replay for each GHSA.

## Security verification in this release

- Added dedicated security regression suite:
  - server: share SEO escaping + ZIP extraction traversal coverage.
  - client/editor: Mermaid sanitizer and unsafe embed URL rejection.
- CI workflow now runs `pnpm test:security` as an explicit gate.

## Operational notes

- New log events for alerting:
  - `[security][embed-url-rejected]`
  - `[security][zip-entry-rejected]`
- Treat recurring events as suspicious input and investigate source requests/import files.
