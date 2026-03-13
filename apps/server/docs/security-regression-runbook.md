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
- Mermaid SVG sanitization (`GHSA-r4hj-mc62-jmwj`)
- ZIP extraction traversal resistance (`GHSA-54pm-hqxm-54wg`)
- Embed URL scheme sanitization (`GHSA-qvxv-4pj5-64xq`)

## Manual staging smoke (required before production rollout)

1. Share SEO:
   - create a page with a title containing HTML/script payload.
   - open public share URL and inspect page source.
   - confirm payload is escaped in `<title>` and OpenGraph/Twitter meta tags.
2. Mermaid:
   - insert a Mermaid block with SVG/script/event-handler payload.
   - confirm no script execution and diagram still renders safe labels.
3. Embed:
   - try `javascript:`, `vbscript:`, `data:text/html` URLs in embed block.
   - confirm iframe is not rendered.
4. ZIP import:
   - import archive with `../`, `..\\`, and absolute-path entries.
   - confirm files are not written outside extraction target.

## Alerting and triage

Watch application logs for:

- `[security][embed-url-rejected]`
- `[security][zip-entry-rejected]`

Recurring events usually indicate hostile payload attempts or malformed imports.
Escalate repeated patterns to security review.
