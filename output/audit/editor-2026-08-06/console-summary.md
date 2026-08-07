# Console evidence summary

This aggregate describes the full baseline run `20260806223904`. Later focused
`ED-006` verification added two current-source console files; those are covered
by `ed-006-remediation.md` and are not included in the baseline totals below.

The final run wrote 11 per-scenario JSON files containing **240 events**:
112 `requestfailed`, 25 console `error`, and 103 `warning`. There were **no
uncaught `pageerror` events**. URLs are reduced to origin/path and token-like
values are redacted before writing.

## Expected or induced by the scenario

- Chromium/Firefox offline probes produced the expected disconnected request,
  WebSocket and offline-resource failures before successful recovery.
- Rejected `https://example.com` iframe previews logged the expected
  `[security][embed-url-rejected]` warning.
- PDF iframe and YouTube requests were frequently aborted during reload,
  navigation, public-context closure or node-view replacement.
- Draw.io bootstrap/style requests were aborted when the harness closed the
  external editor after injecting the documented export message.

## Actionable/noisy observations

- The intentionally minimal `audit-video.mp4` fixture has no decodable media
  track. Firefox logged metadata/decode warnings; video-node visibility and alt
  coverage remain valid, but real video playback is not proven by this fixture.
- Firefox logged XML parser errors for the malicious Mermaid `<img>` label.
  The XSS sentinel stayed unset and event/`javascript:` attributes were absent,
  so this is parser noise after sanitization rather than code execution.
- WebKit logged resource `403` messages without a URL in the console event
  (12 desktop, 6 mobile in the inspected run). Required local media/editor
  assertions still passed; the exact third-party resource is unresolved.
- Chromium emitted one ProseMirror warning: `TextSelection endpoint not
  pointing into a node with inline content (doc)` while moving through the
  complex read-only document.
- Firefox reported unsupported `clipboard-read` / `clipboard-write` feature
  policy names and third-party YouTube/Google warnings.

Raw evidence is in `console-errors/`. These files are deliberately unfiltered;
the summary distinguishes expected test-induced failures from remaining noise
instead of reporting a false clean-console result.
