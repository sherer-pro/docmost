# Editor history map

The path history was reconstructed from `apps/client/src/features/editor`,
`packages/editor-ext/src`, export/collaboration code, and editor-related
migrations.

| Date       | Commit                             | Editor milestone                                                                    |
| ---------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| 2024-01-14 | `9a8b605f`                         | Created `editor-ext`, shared TipTap dependencies, and the collaboration schema.     |
| 2024-06-20 | `1f4bd129`                         | Added core rich blocks: callout, YouTube, image/video, table, details, and math.    |
| 2024-07-12 | `f3885402`                         | Added per-page Markdown/HTML export.                                                |
| 2024-08-24 | `7e80797e`                         | Added Mermaid.                                                                      |
| 2024-08-31 | `38e9eef2`                         | Added Excalidraw.                                                                   |
| 2024-09-01 | `87b99f86`                         | Added Draw.io.                                                                      |
| 2025-01-04 | `287b8338`, `95715421`             | Added and relocated Markdown clipboard handling.                                    |
| 2025-02-14 | `e209aaa2`                         | Added internal page links and mentions.                                             |
| 2026-02-27 | `66974e7c`, `9de16ffa`             | Added rich link previews and fixed plain-text paste behavior.                       |
| 2026-05-27 | `a5460b0a`                         | Ported selected upstream editor features.                                           |
| 2026-06-10 | `8ab73e3d`, `9232336b`, `e43463cb` | Enhanced tables and repaired malformed pasted/persisted rows.                       |
| 2026-06-30 | `47280016`                         | Added indentation and page breaks.                                                  |
| 2026-06-30 | `16119c83`                         | Added the fixed-toolbar preference.                                                 |
| 2026-07-15 | `9e31da0b`, `2dfcef4c`             | Added heading numbering and controls.                                               |
| 2026-07-19 | `179ca2a0`                         | Moved numbering overrides to per-user preferences.                                  |
| 2026-07-19 | `fcd38ef3`, `c16a3d91`             | Unified diagram widths/previews and refined subpage navigation.                     |
| 2026-08-02 | `2b52edd1`                         | Set refined default table styling and default width behavior.                       |
| 2026-08-02 | `264bc159`                         | Swapped odd/even table stripe colors.                                               |
| 2026-08-04 | `5d12a481`                         | Materialized synced blocks during export.                                           |
| 2026-08-05 | `3584bd67`                         | Added templates and managed live page embeds.                                       |
| 2026-08-05 | `2652053d`                         | Stabilized editor/provider lifecycle and collaboration teardown/reconnect behavior. |
| 2026-08-06 | `01d3e35a`                         | Isolated the Mermaid PDF export policy refactor.                                    |

## Migration ledger

| Migration                                                    | Purpose                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| `20260526T123000-page-transclusions.ts`                      | Adds synced-block reference persistence.                     |
| `20260526T124000-clean-legacy-quote-content.ts`              | Removes legacy linked-quote content.                         |
| `20260608T120000-clean-malformed-leading-table-rows.ts`      | Repairs malformed table rows.                                |
| `20260608T121000-repair-stringified-page-content.ts`         | Repairs stringified page JSON.                               |
| `20260608T122000-repair-double-stringified-page-content.ts`  | Repairs double-stringified page JSON.                        |
| `20260608T123000-repair-jsonb-string-page-content.ts`        | Repairs JSONB string page content.                           |
| `20260719T120000-remove-page-heading-numbering-overrides.ts` | Removes page-local overrides after the preference migration. |
| `20260804T140000-page-templates-live-embeds.ts`              | Adds template/live-embed policy, operation, and usage state. |
