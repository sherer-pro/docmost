# Search and attachment indexing audit — 2026-08-07

## Outcome

The audit covered PostgreSQL full-text search, Typesense candidate retrieval,
PostgreSQL hydration and ACL checks, public sharing, attachment extraction,
startup recovery, queue claims, the `search:reindex` CLI, browser pagination,
and AI context search.

Nine defects were confirmed and corrected:

1. Anonymous share search returned private page/space metadata and ancestor
   breadcrumbs.
2. PostgreSQL highlights were not HTML-safe and did not share the Typesense
   `<mark>` contract.
3. Attachment claims compared a PostgreSQL microsecond timestamp with a
   millisecond JavaScript `Date`, so workers could report work without ever
   claiming a row.
4. The production CommonJS build resolved `import('jszip').default` as
   `undefined`, so valid DOCX extraction failed.
5. PDF page operations and DOCX loading were not all guarded by the extraction
   deadline.
6. A definitively missing storage object was treated as a transient error on
   every restart.
7. `search:reindex --entities` and a single-workspace selection did not scope
   the Typesense rebuild, and incompatible retry flags were accepted.
8. Text search pagination had no deterministic tie-breaker.
9. The browser search dialog fetched only the first result page.

All nine are fixed in the accompanying code change. No unrelated worktree
changes are part of this audit.

## Reproducible environment

- PostgreSQL and Redis were isolated by database/Redis DB number from the
  shared development application.
- Typesense used the official image pinned by digest:
  `typesense/typesense:30.2@sha256:610f2d34b1f93d00762869da2c67736775e5798d19a2c8b91b014b8a0cc1e110`.
- The isolated application used the current server/client builds and the same
  database schema as the repository.
- PDF and DOCX fixtures were generated locally and deterministically. The
  encrypted PDF used a known test password; corrupt fixtures were deterministic
  truncations of the generated normal files. No arbitrary external document
  was downloaded.
- The normal PDF was rendered with Poppler and visually inspected. The DOCX
  container and extracted text were verified, but a Word-layout rendering was
  not available because LibreOffice is not installed in this environment.

## Search × backend × role matrix

The values below are result counts. PostgreSQL and Typesense returned the same
ID sets in every compared case. Ranking order is backend-specific and is not
asserted to be identical.

| Scenario                                                    | PostgreSQL | Typesense | Result                    |
| ----------------------------------------------------------- | ---------: | --------: | ------------------------- |
| Workspace admin, identical term in Alpha/Beta/Hidden spaces |          3 |         3 | Same IDs                  |
| Member, identical term across spaces                        |          2 |         2 | Hidden space excluded     |
| Member with `spaceId=Alpha`                                 |          1 |         1 | Same ID                   |
| Member, page-level deny rule                                |          0 |         0 | Denied page excluded      |
| Workspace admin, same page-level deny fixture               |          1 |         1 | Admin policy permits it   |
| Anonymous public share subtree                              |          2 |         2 | Share root and child only |
| Anonymous query outside the share subtree                   |          0 |         0 | No cross-scope result     |
| Member attachment filename query                            |          2 |         2 | Normal PDF and DOCX       |
| Unicode prefix query                                        |          1 |         1 | Same ID                   |
| English morphology query (`run`)                            |          1 |         1 | Same ID                   |
| AI context, cross-space term from Alpha conversation        |          1 |       N/A | Alpha only                |
| AI context, page-level denied term                          |          0 |       N/A | Denied page excluded      |

AI context search deliberately calls the authoritative PostgreSQL
`SearchService` even when the interactive search driver is Typesense. It
supplies the conversation `spaceId`, workspace, user, page ACL snapshot, and AI
content-policy exclusions. The runtime checks above confirmed those boundaries.

Typesense is a candidate index only. Candidate IDs are reloaded from PostgreSQL;
deleted/archived rows are discarded, current PostgreSQL text is used to build
the snippet, and current page access is checked before a hit is returned.

## Query and highlight results

- Unicode, accents, punctuation, emoji, backslashes, boolean punctuation, and
  punctuation-only input all returned HTTP 200. No `to_tsquery` syntax error
  occurred.
- `buildSearchTsQuery` removes characters that `f_unaccent` could expand into
  query syntax while preserving supported `pg-tsquery` operators.
- PostgreSQL `ts_headline` now emits private selection sentinels. The complete
  source fragment is escaped, and only those sentinels become `<mark>` tags.
- The post-fix PostgreSQL hostile fixture returned
  `onerror=alert(1)&gt; <mark>HighlightSafeNeedle</mark>`.
- The equivalent Typesense fixture escaped the entire source tag and contained
  only `<mark>` markup.
- Browser DOM inspection found one `mark`, zero `img`, zero `script`, and zero
  elements with an `onerror` attribute.

## ACL leak proof

Before the fix, anonymous share results included `breadcrumbs`, `createdAt`,
`creatorId`, `databaseId`, `parentPageId`, `space`, and `updatedAt`. A breadcrumb
also exposed the deliberately named ancestor `PRIVATE_ANCESTOR_ACL_LEAK`, which
was outside the shared subtree.

After the fix, both backends returned exactly these keys for every anonymous
share item:

```text
highlight, icon, id, rank, slugId, title
```

The private ancestor marker, space name, space slug, creator ID, parent ID,
timestamps, labels, and database metadata were absent. An out-of-scope query
returned zero results. This projection happens after candidate hydration and
therefore applies equally to PostgreSQL and Typesense.

## Typesense lifecycle and failure contract

- Existing `docmost_pages_v2` and `docmost_attachments_v2` collections contained
  40 and 9 documents respectively.
- Restarting the application with those collections present left BullMQ
  `wait`, `delayed`, and `failed` counts at zero. No startup full rebuild was
  scheduled.
- A first-time missing collection still schedules the deduplicated bootstrap
  rebuild.
- Lifecycle jobs reconcile page create/update/restore/delete, attachment
  indexing, space changes, and workspace deletion.
- A deliberately stopped Typesense container produced the explicit contract:
  HTTP 503 with `Search service unavailable`. Typesense was restarted after the
  check.
- Page and attachment queries use deterministic Typesense sorting by text match
  and `updatedAt`; PostgreSQL text search adds `updatedAt` and `id` tie-breakers.

## Attachment state transitions

| From                       | Event                                       | To           | Retry behavior                     |
| -------------------------- | ------------------------------------------- | ------------ | ---------------------------------- |
| `null`                     | Supported PDF/DOCX creation/import          | `pending`    | Queued/backfilled                  |
| `null`                     | Unsupported file sent directly to extractor | `skipped`    | Terminal, `unsupported_type`       |
| `pending`                  | Atomic claim                                | `processing` | One claim token owns completion    |
| `failed`                   | Explicit `retryFailed` claim                | `processing` | Manual recovery only               |
| `processing`               | Successful extraction                       | `ready`      | Current version is not reprocessed |
| `processing`               | Encrypted/too large/storage missing         | `skipped`    | Terminal                           |
| `processing`               | Corrupt/timeout/archive quota               | `failed`     | Terminal until explicit retry      |
| `processing`               | Storage read/infrastructure failure         | `pending`    | BullMQ bounded retry               |
| stale `processing`         | Startup reconciler, older than 120 seconds  | `pending`    | Recovered once                     |
| `ready`/`skipped`/`failed` | Ordinary startup/backfill                   | unchanged    | No infinite retry                  |

Unsupported uploads normally stay outside the extraction state machine with a
`null` status and are never queued. If an unsupported row reaches the extractor
directly, it is marked `skipped/unsupported_type`.

Claim completion is fenced by attachment ID, file path, `processing` state, and
the exact claim-start token. A deleted or superseded row therefore cannot
publish extracted text or enqueue a Typesense update.

## Fixture results and bounds

| Fixture                                       | Final result                     | Evidence                                                 |
| --------------------------------------------- | -------------------------------- | -------------------------------------------------------- |
| Normal PDF                                    | `ready`, version 1               | 210 extracted characters                                 |
| Normal DOCX                                   | `ready`, version 1               | 165 extracted characters                                 |
| Encrypted PDF                                 | `skipped/encrypted_document`     | No retry on restart                                      |
| Corrupt PDF                                   | `failed/unreadable_document`     | No retry on restart                                      |
| Corrupt DOCX                                  | `failed/unreadable_document`     | No retry on restart                                      |
| Oversized ZIP-based DOCX                      | `failed/archive_limits_exceeded` | 104 MiB uncompressed payload rejected                    |
| 501-page PDF                                  | `ready`, version 1               | Page 500 present; page 501 absent                        |
| Unsupported TXT                               | `null` (not queued)              | Direct-call regression covers `skipped/unsupported_type` |
| Definitively missing object                   | `skipped/storage_missing`        | No retry on restart                                      |
| Object disappears between `exists` and `read` | `pending/storage_unavailable`    | Error is rethrown for bounded BullMQ retry               |
| Attachment row deleted during processing      | No write/index job               | Claim-fenced completion regression                       |

Enforced extraction limits:

- 50 MiB input file/buffer;
- 1,000,000 normalized characters;
- 500 PDF pages;
- 60-second extraction deadline, including module/document/page/DOCX load work;
- 10,000 DOCX entries;
- 25 MiB per DOCX entry;
- 100 MiB total uncompressed DOCX data;
- backfill batches of 100 with concurrency 2.

A never-settling operation was terminated by the deadline regression. The real
501-page boundary fixture completed while omitting page 501.

## `search:reindex` matrix

| Invocation shape                        | Exit | Observed result                                       |
| --------------------------------------- | ---: | ----------------------------------------------------- |
| `--workspace=all`                       |    0 | Queued pages + attachments for all workspaces         |
| UUID + `--entities=pages`               |    0 | Queued workspace-scoped pages rebuild                 |
| UUID + `--entities=attachments`         |    0 | Queued workspace-scoped attachments rebuild           |
| UUID + `--entities=pages,attachments`   |    0 | Queued both scoped entities                           |
| Attachments + `--reextract-attachments` |    0 | Queued one workspace extraction + attachment rebuild  |
| Previous flags + `--retry-failed`       |    0 | Reset exactly 3 failed rows, then processed them once |
| `--retry-failed` without re-extraction  |    1 | Rejected with an explicit dependency error            |
| Re-extraction with pages-only entities  |    1 | Rejected with an explicit entity error                |
| Unsupported entity                      |    1 | Rejected and listed valid entities                    |
| Unknown workspace UUID                  |    1 | Rejected as not found                                 |
| Database driver                         |    0 | Explicitly skipped Typesense rebuild                  |

The processor regression confirms that the queued `workspaceId` and `entities`
are passed through to the index service. Scoped stale-document cleanup uses the
same workspace filter, so a workspace repair does not delete another
workspace's documents.

## Browser verification

The current production client build was served with the isolated PostgreSQL
backend. Searching for 32 deterministic pages showed 25 results initially, a
visible `Load more` control, and 32 results after one click. The control then
disappeared. Clicking the first result navigated to the expected canonical page
URL. No browser console warning/error was recorded for that flow.

The supplied administrator session for `http://localhost:3000` was rejected by
the running application and redirected to login. Temporary test cookies were
removed. Consequently, the authenticated UI assertions above were performed on
the isolated current build at `http://localhost:3200`; the unauthenticated
`localhost:3000` login route was smoke-tested successfully.

## Verification summary

- Targeted server suites: 7 suites, 45 tests passed after the final changes.
- Full client Vitest run: 125 files, 586 tests passed.
- `server:build`: passed.
- `client:build`: passed.
- PostgreSQL and Typesense HTTP matrices: passed with equal result ID sets.
- Browser pagination/navigation/highlight DOM checks: passed on the isolated
  current build.

## Residual risks

- Typesense schema compatibility is controlled by the versioned `_v2`
  collection names rather than field-by-field startup migration. Future schema
  changes must bump the collection version or add an explicit migration.
- Candidate freshness remains eventually consistent. PostgreSQL hydration and
  current ACL checks prevent stale candidates from leaking metadata, but a
  recently changed document can temporarily have an empty authoritative
  snippet until its lifecycle job updates Typesense.
- DOCX text extraction and ZIP limits were verified, but DOCX visual layout was
  not rendered because LibreOffice was unavailable.
