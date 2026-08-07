# Browser matrix

Final Playwright run: `11 passed (1.7m)`. Versions were read from the installed
Playwright browser binaries after the run.

Remediation update: `ED-006` passed a dedicated current-source check in both
desktop engines (`2/2`). The table retains the original full-run observations
and marks the repaired behavior explicitly.

Follow-up update: a fresh isolated trusted-keyboard check passed paragraph
indentation in Chromium and Firefox. The original `ED-002` observation was not
reproduced and is retained only as a historical, potentially state-dependent
baseline result.

| Project | Engine/device | Executed scope | Result | Findings / limitations |
| --- | --- | --- | --- | --- |
| `chromium-desktop` | Chromium `151.0.7922.34`, desktop | Four baseline scenarios plus focused Draw.io remediation and indentation recheck | **4/4 baseline; focused checks passed** | Original `ED-002` observation was not reproduced on fresh recheck; `ED-005` resize disabled; original `ED-006` observation is resolved in the working tree |
| `firefox-desktop` | Firefox `153.0`, desktop | Same four baseline scenarios plus focused Draw.io remediation | **4/4 baseline; Draw.io fix passed** | `ED-005`; original `ED-006` observation is resolved. Synthetic rich paste required an own `clipboardData` property because Firefox ignores constructor-supplied `DataTransfer` |
| `webkit-media-clipboard` | WebKit `26.5`, Desktop Safari profile | Media nodes, fullscreen image, Mermaid valid/invalid/malicious, clipboard capability, reload | **1/1 passed with transport shim** | `ED-007`: on local HTTP, production CSP upgrades subresources to HTTPS. Harness removes only `upgrade-insecure-requests`; all other CSP remains. Audio play returned headless `NotSupportedError` |
| `mobile-chromium` | Chromium, Pixel 7 profile | Simultaneous all-node document, table/mobile reflow, image touch fullscreen, axe | **1/1 passed** | No document-level horizontal overflow; external YouTube remains a third-party dependency |
| `mobile-webkit` | WebKit, iPhone 15 profile | Same mobile/touch scope | **1/1 passed with transport shim** | Same `ED-007` CSP condition; no document-level horizontal overflow |

## Cross-browser behavior matrix

| Behavior | Chromium | Firefox | WebKit desktop | Mobile Chromium | Mobile WebKit |
| --- | --- | --- | --- | --- | --- |
| Fixed/unfixed toolbar and preference persistence | Pass | Pass | Not in scoped project | N/A | N/A |
| Toolbar Tab focus order | Pass | Pass | Not run | N/A | N/A |
| Paragraph Tab indent/outdent | **Pass on fresh recheck; baseline observation not reproduced** | Pass | Not run | N/A | N/A |
| Heading numbering/reset/preferences | Pass | Pass | Rendered only | Rendered | Rendered |
| Page break create/copy/delete/export | Pass | Pass | Rendered only | Rendered | Rendered |
| Table paste/merge/add/remove/read-edit | Pass | Pass | Rendered only | Rendered/reflow | Rendered/reflow |
| Table column resize | **Fail** | **Fail** | N/A | N/A | N/A |
| Image fullscreen and alt | Pass | Pass | Pass | Pass (touch) | Pass (touch) |
| Audio upload/render/play | Pass | Pass | Render pass; play unsupported | Rendered | Rendered |
| PDF viewer | Pass | Pass | Visible | Visible | Visible |
| Draw.io copy/save | **Remediation pass** | **Remediation pass** | Rendered only | Rendered | Rendered |
| Excalidraw preview/alt | Pass | Pass | Pass | Pass | Pass |
| Mermaid valid/invalid/malicious | Pass | Pass | Pass | Rendered | Rendered |
| Internal/external link preview | Pass | Pass | Rendered | Rendered | Rendered |
| Subpage navigation | Pass | Pass | Not run | Rendered | Rendered |
| Large Markdown/HTML paste | Pass | Pass | Clipboard API exposed | N/A | N/A |
| Slash commands; undo/redo | Pass | Pass | Not run | N/A | N/A |
| Two-user collaboration | Pass | Pass | Not run | N/A | N/A |
| Authenticated readonly/public share | Pass | Pass | Rendered readonly | Rendered readonly | Rendered readonly |
| Reload/offline interruption/recovery | Pass, custom offline page | Pass, browser offline page | Reload pass | Reload pass | Reload pass |

The retained audit space is intentional: the runner deletes it only when the
suite passes and no defects are recorded. The baseline retained it for seven
observations across four defect IDs; `ED-006` is now resolved in the working
tree, `ED-002` was not reproduced on a fresh isolated recheck, and `ED-005` and
`ED-007` remain open.
