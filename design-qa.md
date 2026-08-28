# Design QA - Page templates

## Reference and implementation

- Reference: `C:/Users/Pavel/.codex/generated_images/01a000b6-1f04-7501-892b-623ec802ddea/exec-1474e405-762b-484b-a9af-6aa246b4eb54.png`.
- Final desktop comparison: `output/audit/page-templates-redesign-final/manual-browser/catalog-drawer-final-matched-1536x1024.png`.
- The final implementation preserves the selected composition: familiar Docmost navigation, a compact template list, outcome-based labels, and an on-demand details panel.
- The desktop details panel keeps the catalogue visible without a dimmed overlay. The mobile details panel remains a full-height sheet.

## Responsive and interaction checks

- Browser checks covered 320, 390, 767, 768, 1440, and 1536 CSS-pixel widths without document-level horizontal overflow.
- The 720 CSS-pixel Playwright check represents the effective layout width of a 1440-pixel viewport at 200% browser zoom.
- Desktop row selection opens the right-side details panel and returns focus to the selected row after closing.
- Mobile row selection opens a full-height sheet at both 320 and 390 pixel widths.
- The two-step creation wizard defaults to `Independent copy`, keeps creation behind the final confirmation, and supports keyboard navigation.
- Workspace and space policy surfaces expose deployment, workspace, space, group, and effective-result states without changing policy during QA.

## Evidence

- Page-template Playwright lifecycle: 24/24 passed across desktop Chromium, desktop Firefox, Mobile Chromium, and Mobile WebKit.
- Template catalogue component tests: 18/18 passed.
- Axe checks in the lifecycle cover the catalogue, linked-instance status, and recovery states.
- Manual browser captures are stored under `output/audit/page-templates-redesign-final/manual-browser`.

## Boundaries

- The full editor browser matrix completed 41/45. Four failures are the same unrelated Draw.io iframe availability assertion in two desktop scenarios across Chromium and Firefox; all 24 page-template cases in that matrix passed.
- Hosted CI, physical devices, and production deployment were not exercised.

final result: passed

---

# Design QA: AI profile picker and resizable panel

## Source and implementation evidence

- Source references:
  - `C:/Users/Pavel/AppData/Local/Temp/codex-clipboard-d3a60b9c-985a-4982-ae00-49669ae44115.png`.
  - `C:/Users/Pavel/AppData/Local/Temp/codex-clipboard-bf10b443-0776-4246-b3c8-e189786fb76d.png`.
- Desktop profile menu at a 1600 x 900 CSS viewport:
  - `C:/Users/Pavel/.codex/visualizations/2026/08/27/01a04554-34ec-7751-996f-83660ac4efe4/ai-profile-menu-descriptions-520.png`.
- Desktop overlay at a 1600 x 900 CSS viewport and 600-pixel panel width:
  - `C:/Users/Pavel/.codex/visualizations/2026/08/27/01a04554-34ec-7751-996f-83660ac4efe4/ai-panel-overlay-600.png`.
- Mobile profile drawer at a 390 x 844 CSS viewport:
  - `C:/Users/Pavel/.codex/visualizations/2026/08/27/01a04554-34ec-7751-996f-83660ac4efe4/ai-panel-mobile-profile-descriptions.png`.
- Runtime: authenticated local Docmost at `http://localhost:5173/s/refix/p/2026-07-16-konczepcziya-WRMWs5wbCY`.

The references and implementation screenshots were inspected together. The implementation keeps the selected compact composer hierarchy while adding the requested descriptive second line and retaining Docmost's existing typography, tokens, icons, and light theme.

## Geometry and interaction coverage

- The desktop selector is allowed to grow to 280 pixels; the compact 128-pixel cap remains active in narrow composer containers.
- The desktop menu measured exactly 360 CSS pixels with no horizontal scroll. Both available options exposed a title/version line and a description line.
- The 12-pixel separator exposed `aria-valuemin=360`, `aria-valuemax=600`, and a live `aria-valuenow`.
- Keyboard checks covered ArrowLeft/ArrowRight, Home, and End at both bounds.
- Pointer drag moved the panel from 600 to 400 pixels and back to 600. The 600-pixel state switched to overlay at a 1600-pixel viewport; the 400-pixel state docked again.
- The same composer DOM retained `QA_RESIZE_DRAFT` during both docked/overlay transitions.
- At 600 pixels, the footer measured 542 client pixels and 542 scroll pixels. At the 390-pixel mobile viewport, it measured 333/333, so no horizontal overflow was present.
- Mobile fullscreen contained no resize separator and reused the same two descriptions in the full-height profile drawer.

## Findings and boundaries

- No actionable P0, P1, or P2 visual mismatch remained after the exact 360-pixel menu-width fix.
- The blue focused/dragging separator is visibly distinct without increasing the visual divider beyond two pixels.
- The local authenticated session returned HTTP 403 from `POST /api/users/update`, so persistence after reload could not be accepted against that runtime. The local width was restored to its original 520 pixels. Payload clamping and keyboard persistence inputs are covered by unit tests; full AI E2E was also blocked before execution because `DOCMOST_ADMIN_EMAIL` was not supplied.
- The browser console still contains the pre-existing editor `flushSync` warning documented in the earlier AI-chat QA section. No new warning identified the profile picker or resize implementation.

final result: passed

---

# Design QA: AI assistant profile editor

## Result

`passed`

The implemented editor preserves the selected concept's hierarchy and visual direction while using Docmost's existing Mantine tokens, Assistant typeface, Tabler icons, and form controls. No P0, P1, or P2 design defects remain in the checked flow.

## Evidence

- Source reference: `C:/Users/Pavel/.codex/generated_images/01a026be-1066-7881-8471-9568ae044792/exec-60b9d183-cb0a-471e-8595-0d9ed862cd57.png`
- Desktop implementation: `D:/DevProjects/docmost/design-qa-implementation-desktop.png`
- Narrow implementation: `D:/DevProjects/docmost/design-qa-implementation-narrow.png`
- Mobile implementation: `D:/DevProjects/docmost/design-qa-implementation-mobile.png`
- Desktop comparison size: 1136 x 1384 CSS pixels, matching the source image pixel dimensions.
- Responsive checks: 760 x 900 and 390 x 844 CSS pixels.
- Rendering source: authenticated local Docmost runtime at `http://localhost:5173/settings/ai/spaces/refix`.

The full-frame captures retain readable labels, icons, state badges, and controls at native density, so an additional zoom crop was not needed.

## Fidelity review

- Layout: matched the concept's large editor surface, persistent left navigation, preview card, icon grid, content workspace, and fixed action footer.
- Hierarchy: retained the concept's six-step structure and strengthened the Tools section with explicit capability categories and selected counts.
- Typography and color: aligned with Docmost's existing design system rather than introducing mock-specific font or token overrides.
- Iconography: replaced text-based icon selection with a visual Tabler icon grid; navigation, categories, tool rows, and actions use real icons.
- Responsive behavior: the sidebar becomes a horizontal section navigator; the active section is automatically scrolled into view; footer actions remain visible.
- States: verified active navigation, input focus, read/write badges, selected groups, tool search, required-field validation, and empty external-MCP selection.
- Localization: the runtime capture used the authenticated account's English locale; all new strings are present in every 12 supported locale files, including Russian.
- Image quality: not applicable; the interface uses vector icons and CSS surfaces only.

## Functional QA

- Tool search filtered the list to the two matching Replace actions and restored the full list after clearing.
- Saving an empty form moved focus to Basics and displayed the required name error without issuing a mutation.
- Browser console contained no warnings or errors during the checked interactions.
- Client lint, targeted Vitest tests, and the production client build passed.

## Intentional differences from the source

- Built-in tools are grouped by capability category instead of shown as one flat list. This improves scanability while preserving the exact allowlist behavior.
- Group policies and launch settings live in their own sections instead of extending the Tools view, reducing vertical overload.
- The icon catalog uses the eight profile icons supported by the current API contract.

## Remaining verification boundary

The visual check covers local authenticated desktop, narrow, and mobile browser viewports. It does not constitute production deployment, physical-device, screen-reader, or full browser-matrix sign-off.

---

# Design QA: AI chat and composer redesign

## Source and implementation evidence

- Source visual truth:
  - `C:/Users/Pavel/AppData/Local/Temp/codex-clipboard-c9a019b7-59d6-4dfe-bae9-83ce3e7c363c.png` — 966 x 252 pixels.
  - `C:/Users/Pavel/AppData/Local/Temp/codex-clipboard-b83cdbcf-c4fe-4ecb-8f0f-04dd74c90c5d.png` — 1138 x 174 pixels.
  - `C:/Users/Pavel/AppData/Local/Temp/codex-clipboard-710cd78a-3a7e-4e6e-9fbd-d7ed8149e2f9.png` — 1129 x 809 pixels.
- Browser-rendered implementation:
  - `C:/Users/Pavel/.codex/visualizations/2026/08/27/01a04554-34ec-7751-996f-83660ac4efe4/ai-chat-desktop-1440.png` — 1425 x 891 pixels at a 1440 x 900 CSS viewport and device scale factor 1.
  - `C:/Users/Pavel/.codex/visualizations/2026/08/27/01a04554-34ec-7751-996f-83660ac4efe4/ai-chat-desktop-add-menu.png` — the same viewport with the unified add menu open.
  - `C:/Users/Pavel/.codex/visualizations/2026/08/27/01a04554-34ec-7751-996f-83660ac4efe4/ai-chat-desktop-slash-menu.png` — the same viewport with the slash-command listbox open.
  - `C:/Users/Pavel/.codex/visualizations/2026/08/27/01a04554-34ec-7751-996f-83660ac4efe4/ai-chat-focus-1440.png` — adaptive fullscreen focus mode at 1440 x 900 CSS pixels.
  - `C:/Users/Pavel/.codex/visualizations/2026/08/27/01a04554-34ec-7751-996f-83660ac4efe4/ai-chat-mobile-390.png` and `ai-chat-mobile-add-drawer.png` — 390 x 844 CSS pixels at device scale factor 1.
- Combined focused comparison: `C:/Users/Pavel/.codex/visualizations/2026/08/27/01a04554-34ec-7751-996f-83660ac4efe4/ai-chat-comparison-desktop.png`.
- Runtime: authenticated local Docmost at `http://localhost:5173/s/refix/p/2026-07-16-konczepcziya-WRMWs5wbCY`.

The source images are reference compositions rather than same-viewport Docmost mocks. They were kept at their native pixel density and compared in one composite against native-density focused crops of the implementation. Exact color matching was not used because the references use a dark theme while the authenticated Docmost session uses its existing light theme.

## State and interaction coverage

- Empty new chat with selected assistant identity and four quick commands.
- Current-document context chip and its remove affordance.
- Unified desktop add menu with files, context, space search, templates, and formatting.
- Mobile add drawer with the same actions and explicit scrolling.
- Profile-first selector on desktop and its mobile bottom drawer.
- Slash-command listbox, keyboard selection entry point, and Escape dismissal.
- Adaptive focus mode: fullscreen at 1440 x 900 because docking would leave less than 720 CSS pixels for the document; Escape restored the prior 447-pixel docked panel.
- Mobile composer at 390 x 844 with no horizontal overflow. Add, profile, and send controls measured at 44 CSS pixels high.

## Fidelity review

- Fonts and typography: the implementation keeps Docmost's Assistant family, existing weights, readable 14–16 pixel hierarchy, controlled truncation, and clear placeholder/status contrast. The references' denser labels are represented through the profile chip and compact menu labels without introducing a second type system.
- Spacing and layout rhythm: the composer is a single rounded surface with a context rail, flexible editor, and persistent footer. The 18-pixel radius, restrained shadow, 6–10 pixel internal rhythm, and floating add menu reproduce the references' compact input hierarchy. The focused comparison found no clipped content or persistent-control overlap.
- Colors and visual tokens: all surfaces use existing Mantine/Docmost light-dark tokens and semantic blue/red states. The reference dark palette was treated as inspiration rather than a required theme override.
- Image and asset fidelity: no raster product imagery is required. All visible controls use the existing Tabler icon library or the existing assistant-profile icon mapping; no handcrafted SVG, emoji substitute, or placeholder asset was introduced.
- Copy and content: the composer exposes concise action names, preserves the current document title in a removable chip, avoids raw model/effort language, and adds localized focus/add/placeholder strings in all 12 locale files.

## Findings and comparison history

- No actionable P0, P1, or P2 visual mismatch was found in the first combined comparison, so no post-comparison visual fix iteration was required.
- P3: the desktop docked composer hides the keyboard shortcut hint at widths below 520 CSS pixels to preserve the profile-first hierarchy. The hint remains visible in wider focus mode and keyboard behavior is unchanged.
- The browser console contained repeated pre-existing React `flushSync` warnings from `DictionaryHighlightLayer`/editor rendering. No warning pointed to the AI panel or composer, and no functional or visual failure accompanied them.

The full-view captures were used for panel proportions, empty state, and responsive behavior. The combined focused crop was necessary because composer controls and menu typography are too small to judge reliably in the full 1440-pixel frame.

## Remaining boundary

The QA covers the authenticated local Chromium-based in-app browser, desktop/mobile responsive geometry, keyboard Escape recovery, and visible interaction states. It does not constitute physical-device, screen-reader, production deployment, or cross-browser sign-off.

final result: passed
