# Security Regression Runbook

Use this runbook before release candidates and after any security-related merge.

## Automated checks

Run the focused security suite:

```bash
pnpm test:security
```

Run the standard quick verification:

```bash
pnpm verify:quick
```

## Covered regression classes

- Share SEO title/meta escaping (`GHSA-h7fp-4f37-29wq`)
- Share SEO metadata suppression when workspace/space sharing is disabled.
- Mermaid SVG sanitization and editor link URL sanitization (`GHSA-r4hj-mc62-jmwj`)
- ZIP extraction traversal resistance and extraction quotas (`GHSA-54pm-hqxm-54wg`)
- Embed URL scheme sanitization, same-origin relative URL rejection, shared frame-source allowlisting, and generic iframe sandbox hardening (`GHSA-qvxv-4pj5-64xq`)
- PDF export SSRF resistance through Chromium resource request allowlisting.
- Attachment MIME confusion resistance for inline-capable file extensions.
- Imported attachment MIME/signature validation before storage persistence.
- Import embed node formatting through structured DOM attributes instead of raw HTML string interpolation.
- Forwarded-header spoofing resistance for rate limiting, session IP capture, request logging, and HTTPS/HSTS detection.
- Cloud host parsing rejects untrusted domains and nested/malformed workspace host labels.
- CSRF origin/referer validation for authenticated mutating routes, including logout.
- Public invitation/share/search/hostname endpoints are covered by auth rate-limit buckets.
- Workspace invitation links require token validation; stored invitation tokens are hashed and expire.
- Legacy public attachment `?jwt=` query tokens are lower priority than header/cookie tokens and emit deprecation headers when used.

## Manual staging smoke (required before production rollout)

1. Share SEO:
   - create a page with a title containing HTML/script payload.
   - open public share URL and inspect page source.
   - confirm payload is escaped in `<title>` and OpenGraph/Twitter meta tags.
   - disable sharing at workspace or space level and confirm the share shell no longer includes page-specific title/meta tags.
2. Mermaid:
   - insert a Mermaid block with SVG/script/event-handler payload.
   - confirm no script execution and diagram still renders safe labels.
   - include `data:image/svg+xml`, `blob:`, protocol-relative URLs, and CSS `url(...)` payloads and confirm they are stripped.
3. Embed:
   - try `javascript:`, `vbscript:`, `data:text/html`, and relative `/api/...` URLs in embed block.
   - confirm iframe is not rendered for rejected URLs.
   - confirm generic iframe embeds do not include `allow-same-origin` in their sandbox.
   - try an arbitrary generic HTTPS iframe while `EMBED_ALLOWED_ORIGINS` is empty and confirm it is rejected.
   - set `EMBED_ALLOWED_ORIGINS` to that exact origin and confirm the same generic iframe is accepted.
4. ZIP import:
   - import archive with `../`, `..\\`, and absolute-path entries.
   - confirm files are not written outside extraction target.
   - import archives that exceed entry count or uncompressed-size quotas.
   - confirm extraction fails instead of partially accepting oversized archives.
5. Reverse proxy:
   - with `TRUSTED_PROXIES` empty, send `X-Forwarded-For` and `X-Forwarded-Proto` directly to the app.
   - confirm auth rate limits and session IP capture use the socket remote address, and HSTS is not enabled only because of spoofed `X-Forwarded-Proto`.
   - set `TRUSTED_PROXIES` to the staging proxy CIDR and confirm client IP/HSTS are resolved correctly through that proxy.
6. Public attachments:
   - open a public attachment URL with only legacy `?jwt=<token>` and confirm the response includes `Deprecation: true` and a `Warning` header.
   - repeat with `x-attachment-token` or attachment cookies and confirm no deprecation header is emitted.
   - upload or seed an inline-capable extension with a mismatched MIME type and confirm it is served as a download with `application/octet-stream`.
7. PDF export:
   - export a page containing external image URLs, private-network URLs, and public attachment images.
   - confirm only `data:` resources and same-origin public attachment URLs are fetched by Chromium.

## Alerting and triage

Watch application logs for:

- `[security][embed-url-rejected]`
- `[security][zip-entry-rejected]`

Recurring events usually indicate hostile payload attempts or malformed imports.
Escalate repeated patterns to security review.
