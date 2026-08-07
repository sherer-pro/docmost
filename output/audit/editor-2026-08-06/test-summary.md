# Executed verification summary

## Browser execution

| Scope | Result |
| --- | --- |
| Final Playwright matrix | **11/11 passed in 1.7 minutes** |
| Chromium desktop | 4/4 passed |
| Firefox desktop | 4/4 passed |
| WebKit desktop media/clipboard | 1/1 passed with disclosed CSP transport shim |
| Pixel 7 mobile Chromium | 1/1 passed |
| iPhone 15 mobile WebKit | 1/1 passed with disclosed CSP transport shim |
| Screenshots | 23 final, manually inspected |
| axe | 8 JSON scans captured; violations reported separately |
| Console | 11 JSON logs captured; 0 uncaught `pageerror` events |

## ED-006 remediation verification

| Scope | Result |
| --- | --- |
| Focused Draw.io copy-on-write E2E | **2/2 passed**: Chromium and Firefox |
| Diagram helper unit test | 1 file, 9 tests passed |
| Full client Vitest run during remediation | 120 files, 553 tests passed |
| Client `tsc && vite build` after remediation | Passed; existing large-chunk warning only |
| ESLint and Prettier for touched production/test files | Passed |
| Playwright discovery after adding the regression | 13 tests in 6 files |

The focused browser check used the current Vite source with collaboration and
API traffic routed to the existing backend. `DOCMOST_API_ORIGIN` preserved the
backend's trusted origin instead of weakening CSRF validation.

The runner created isolated audit space `019fd93a-eab9-71b2-b899-28985cd739dc`.
It was retained by design because confirmed defects exist. Runtime credentials
were supplied only through environment variables and are absent from artifacts.

## Unit, security, export and build checks

| Command/scope | Result |
| --- | --- |
| `corepack pnpm test:editor-ext` | 12 files, 48 tests passed |
| Client Mermaid/link/embed security suite | 6 files, 74 tests passed |
| Server export controller/service/PDF renderer subset | 3 suites, 33 tests passed |
| Client page-embed/diagram/image/Mermaid/transclusion/table subset | 6 files, 29 tests passed; happy-dom printed an abort-at-teardown diagnostic |
| New indent keyboard regression | 1 file, 1 test passed |
| ESLint for Playwright config, E2E harness and new unit test | Passed, no output |
| Client `tsc && vite build` | Passed; existing large-chunk warning only |

Total focused unit/security/export assertions in the final verification phase:
**185 passed**.

## Export inspection

- Markdown, HTML and PDF ZIP exports succeeded in Chromium and Firefox.
- HTML archives contained the page-break marker and no executable event or
  `javascript:` URL attributes after DOM parsing.
- Each generated editor PDF is a six-page tagged A4 PDF with no JavaScript.
- Each embedded source PDF is a one-page Letter PDF with no JavaScript.
- Metadata was read with the official Poppler `pdfinfo.exe` from the bundled
  runtime.

## Known limitations

- The local MP4 fixture validates node rendering and alt persistence but is not
  a decodable playback sample in Firefox.
- Headless WebKit exposes the audio element but rejects `play()` with
  `NotSupportedError`.
- Interactive Excalidraw editing was not automated; render/alt serialization
  was covered.
- WebKit feature assertions require stripping only
  `upgrade-insecure-requests` from local HTTP response CSP (`ED-007`).
