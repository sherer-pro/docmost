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
- Invitation create/resend/accept side effects are committed through the transactional outbox. Raw invitation tokens are encrypted outside the regular JSON payload, checked against the live invitation immediately before delivery, and cleared in every terminal state.
- Queue worker failure logs omit BullMQ `failedReason`, domain identifiers, mail addresses, URL query values, and raw provider errors. CI production-smoke logs are redacted as a stream and scanned before artifact upload.
- Aggregated push rows use expiring owner tokens plus row revisions; a new event cannot steal an active lease, and an expired owner cannot finalize after takeover.
- Logged URLs exclude query values, and mail logs exclude recipients, subjects, bodies, invitation links, and raw provider errors.
- Redis collaboration leases renew and release only for their random owner token; renewal failure closes the local document before another instance can take ownership.
- Legacy public attachment `?jwt=` query tokens are lower priority than header/cookie tokens and emit deprecation headers when used.
- Space security policy overrides resolve MFA, SSO, and public-sharing enforcement as `space override ?? workspace default`.
- Authentication assurance is session-bound: workspace routes require workspace policy, while explicitly scoped space resources use that space's effective policy and return HTTP 428 when step-up is required.
- SSO step-up is one-time, bound to the current user/session, rejects account switching and unsafe return URLs, and does not create users or sessions.
- Restricted WebSocket sessions join only eligible space rooms; canonical collab tokens are page-bound and recheck session assurance for the page's space.

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
8. Space policy overrides and step-up:
   - exercise all workspace values with space `inherit`, `enabled`, and `disabled` overrides for MFA, SSO, and public sharing.
   - confirm a space administrator can only set an explicit `enabled` override; confirm only a workspace `admin|owner` can select `inherit` or `disabled`.
   - use an old active session with null assurance and confirm workspace/global APIs return `428 AUTHENTICATION_ASSURANCE_REQUIRED`, while bootstrap endpoints and a space with a compatible override remain available.
   - complete SSO then MFA step-up and confirm the same session gains both assurance flags and returns only to a relative `returnTo` path.
   - replay an SSO state, alter the session cookie, and authenticate as another external identity; confirm every attempt is rejected.
   - disable MFA and confirm all of the user's active sessions immediately lose MFA assurance.
9. Public-sharing transitions:
   - move a space from effective sharing allowed to disabled and confirm its share rows are deleted in the same policy transaction.
   - set an explicit `disabled=false` override while the workspace default is disabled and confirm existing links are not deleted by that space update.
   - concurrently create a share and change workspace/space sharing policy; confirm the workspace-then-space lock order prevents a share surviving an effective disabled transition.
10. Restricted realtime access:
   - connect with a session that fails workspace assurance but satisfies one space override.
   - confirm it joins only that `space-*` room, cannot publish workspace presence, and cannot obtain a legacy unscoped collab token.
   - request a canonical collab token with `pageId`; confirm it cannot be reused for another page and is rejected after policy or session assurance changes.
   - tighten a workspace or space policy while Socket.IO and collab connections are idle; confirm Socket.IO rooms are refreshed immediately and collab authorization is re-evaluated before the next message is handled or broadcast.
11. Invitation outbox and log privacy:
   - stop the BullMQ worker, create or resend an invitation, and confirm the invitation plus one `pending` outbox row commit while no email is sent.
   - restart the worker and confirm the periodic sweep processes the row without another API request.
   - rotate or consume an invitation before its row is processed and confirm the stale row becomes `cancelled` without sending the old link.
   - inspect application logs for these flows and confirm they contain no email address, subject, message body, invitation token, URL query value, or raw mail-provider response.
12. Collaboration lease ownership:
   - run two collaboration instances against the same Redis and document ID.
   - confirm a non-owner cannot renew or release the current owner's lease.
   - interrupt the owner's Redis renewal path and confirm it closes the local document; confirm only then can the second instance acquire ownership.

## Alerting and triage

Watch application logs for:

- `[security][embed-url-rejected]`
- `[security][zip-entry-rejected]`
- `mail_delivery_disabled`
- `Outbox entry <id> exhausted its processing attempts`
- `Collaboration document lease lost`

Recurring events usually indicate hostile payload attempts or malformed imports.
Escalate repeated patterns to security review.
