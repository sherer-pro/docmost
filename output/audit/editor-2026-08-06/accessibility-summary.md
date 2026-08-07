# Accessibility evidence summary

Eight `axe-core` scans ran with WCAG 2.0/2.1 A and AA tags: authenticated
all-node read mode, public all-node share, editable operations in Chromium and
Firefox, plus Pixel 7 and iPhone 15 read-only documents.

The scans captured **7 unique violation rules**, **50 rule occurrences**, and
**145 affected-node instances**. Counts repeat the same component when it
appears in multiple browsers/states; they are not 145 unique source elements.
There were also 200 passing checks and 24 incomplete/manual-review checks.

| Rule | Impact | Scans | Node instances | Representative evidence |
| --- | --- | ---: | ---: | --- |
| `button-name` | critical | 8/8 | 50 | Details toggle and code-block action icons have no accessible name |
| `aria-allowed-attr` | critical | 8/8 | 34 | Read-only ProseMirror retains `aria-multiline`; math wrappers expose dialog ARIA on a non-semantic `div` |
| `image-alt` | critical | 8/8 | 8 | Sanitized malicious Mermaid label leaves an inert `<img src="x">` without `alt` |
| `color-contrast` | serious | 8/8 | 22 | Inline code, callout icon text and highlighted code tokens fail AA contrast |
| `aria-prohibited-attr` | serious | 7/8 | 12 | Comment editor and embedded-player descendants expose prohibited ARIA combinations |
| `frame-title` | serious | 6/8 | 12 | PDF and YouTube iframes have no `title` |
| `aria-input-field-name` | serious | 5/8 | 7 | Read-only transclusion textbox has no accessible name |

Keyboard checks beyond axe:

- fixed-toolbar controls accepted focus and advanced with `Tab` in Chromium
  and Firefox;
- the editor itself has an accessible name in edit/read modes;
- trusted paragraph `Tab` indentation passed in Chromium and Firefox on a
  fresh isolated recheck; the earlier Chromium-only `ED-002` observation was
  not reproduced and remains historical evidence;
- fullscreen image dialogs were located by accessible dialog name in desktop
  and touch profiles.

Raw per-scan JSON is in `axe-results/`. The suite intentionally records rather
than suppresses these violations, so an 11/11 Playwright result is not an
accessibility pass.
