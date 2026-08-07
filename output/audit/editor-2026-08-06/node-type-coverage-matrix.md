# Node-type coverage matrix

Final run: `20260806223904`. Desktop all-node coverage executed in Chromium
151 and Firefox 153. Media coverage also executed in WebKit 26.5; the complete
read-only document was rendered on Pixel 7 and iPhone 15 profiles.

Legend: **Pass** means persisted serialization and the named browser behavior
were asserted. **Schema pass** means the type was present in the simultaneous
all-node document and survived API serialization, with rendering visible in the
document screenshot. **Gap** is a confirmed product defect. **Limited** records
an explicit capability or fixture boundary.

| Node/mark | Simultaneous fixture | Browser/read-only/export evidence | Result |
| --- | --- | --- | --- |
| `doc`, `text`, `paragraph` | Yes | API serialization; authenticated read/edit; public share; mobile | Pass |
| `heading` | Levels 1/2/3 plus reset branch | Sequence `1`, `1.1`, `1.1.1`, `1.2`; preference persisted and restored | Pass |
| `blockquote` | Yes | Read-only, public, mobile screenshots | Schema pass |
| `bulletList`, `orderedList`, `listItem` | Yes; ordered list starts at 3 | Read-only/public/mobile rendering | Pass |
| `taskList`, `taskItem` | Yes; checked item | Read-only/public/mobile rendering | Pass |
| `hardBreak`, `horizontalRule` | Yes | Serialized and rendered | Schema pass |
| `details`, `detailsSummary`, `detailsContent` | Yes; open details | Serialized and rendered | Pass |
| `callout` | Warning callout | Serialized and rendered | Pass |
| `mathInline`, `mathBlock` | Yes | KaTeX visible in read-only/public/mobile | Pass |
| `table`, `tableRow`, `tableCell`, `tableHeader` | Full-width, striped, merged target and wide content | Create/paste; add/remove row and column; merge; read/edit; mobile no document overflow | **Gap:** resize handles absent (`ED-005`) |
| `pageBreak` | Yes | Create, trusted copy event, delete, HTML marker, six-page PDF export | Pass |
| `image` | Local PNG with width/alignment/alt | Visible in read/public/mobile; fullscreen dialog and alt asserted | Pass |
| `video` | Local `video/mp4` node with alt | Node/controls/alt visible in all engines | Limited: the deliberately minimal MP4 fixture has no decodable video track in Firefox |
| `audio` | Generated local WAV | Native element and metadata preload; play/pause passed in Chromium and Firefox | Limited: headless WebKit returned `NotSupportedError` |
| `pdf` | Generated local one-page PDF | Viewer iframe visible; archive includes source; PDF export inspected with official Poppler `pdfinfo` | Pass |
| `attachment` | Local text file | Visible and included in Markdown/HTML/PDF archives | Pass |
| `drawio` | Local SVG attachment with title/alt/width | Preview, clipboard HTML, pasted copy, simulated iframe export/save | **Pass after remediation:** copy-on-write verified in Chromium and Firefox (`ED-006`) |
| `excalidraw` | Local attachment with title/alt/width | Serialized and preview/alt visible | Limited: interactive Excalidraw editing was not automated |
| `codeBlock` | TypeScript plus valid, invalid and malicious Mermaid | Valid SVG; localized invalid error; no script/event/`javascript:` execution; reload survived | Pass; axe still flags fixture-produced unlabeled image |
| `embed` | Rejected generic external origin | Safe policy warning and inert rendering | Pass |
| `youtube` | Privacy-enhanced embed | Rendered where third-party availability allowed; external aborts retained in console evidence | Pass with external dependency |
| `linkPreview` | Internal and external | Safe external `href`; internal slug link; readonly/public rendering | Pass |
| `mention` | Page mention | Serialized and rendered; archive conversion covered by exporter | Pass |
| `tag` | Inline TODO tag | Serialized and rendered | Pass |
| `subpages` | Child page node | Link navigation to child and return in Chromium/Firefox | Pass |
| `transclusionSource` | Local synced-block source | Materialized source content visible | Pass |
| `transclusionReference` | Reference to source | Resolved reference content visible | Pass |
| `bold`, `italic`, `underline`, `strike` | Yes | DOM tags asserted | Pass |
| `code`, `superscript`, `subscript`, `highlight` | Yes | Persisted marks; DOM tags asserted except inline code via serialization | Pass |
| `textStyle` / color | Yes | Persisted and visibly colored | Pass |
| `link` | Internal and external | Safe `href` assertions; malicious pasted `javascript:` removed | Pass |
| `comment` | Yes | `.comment-mark` text asserted | Pass |

Cross-cutting block-width coverage is present for `normal`, `wide`, and `full`
modes; a full-width node was asserted in the all-node document. The table
default style and stripe changes from `2b52edd` and `264bc159` are represented
by the seeded full-width striped table.
