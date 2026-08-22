# Legacy whole-page embed pre-upgrade runbook

This runbook is mandatory before migration
`20260822T040000-remove-legacy-page-embeds` for every installation, including
one whose read-only plan reports no retained whole-page `pageEmbed` state. The
command is supplied by the v1.2.3 candidate but is designed to run against the
pre-T040 schema. It does not start the API, collaboration runtime, or queue
workers.

The command never prints page titles, document bodies, comment text, file names,
or user data. Its JSON report contains counts, surface/kind/status values, at
most 25 opaque hashes per surface, and bounded-scan diagnostics.

## Preconditions

1. Pin the exact candidate checkout and image digest that will perform the
   upgrade.
2. Create and verify a coordinated PostgreSQL and file-storage backup. Retain
   its operator-visible identifier for `--backup-ack`.
3. Close ingress and stop every API, collaboration, and worker process that can
   write pages, attachments, templates, comments, databases, history, or
   transclusion references. The CLI advisory lock only excludes a second copy
   of this CLI; it is not an application-wide maintenance switch.
4. Configure the candidate process with the production `DATABASE_URL` and the
   same `STORAGE_DRIVER` configuration as the stopped application. Local
   storage uses the configured Docmost storage root. S3 requires
   `AWS_S3_REGION` and `AWS_S3_BUCKET`; endpoint and static credentials remain
   optional under the normal storage contract.

Do not start the migration operator yet. T040 removes the legacy columns needed
by this command.

## Read-only plan

Run the plan first. It performs keyset-batched semantic Yjs decoding and does
not create a ledger, copy a file, or mutate a database row.

```bash
corepack pnpm --filter ./apps/server page-embed:prepare-removal -- \
  --batch-size=100 \
  --context-page-limit=5000
```

`--batch-size` accepts 1 through 500. `--context-page-limit` must be at least
the batch size and accepts up to 50000. Source traversal is limited to the same
20 levels used by materialization, ancestor discovery to 100 levels, and the
total decoded materialization graph to the explicit context limit. Review
`batching.maxDecodedPageBatch` and
`batching.maxMaterializationContextPages` in the report.

The read-only plan is not sufficient authorization for T040. The migration
requires an exact `page_embed_removal_ledger` row for every page, and only the
apply command creates those rows. Therefore the apply step below is mandatory
even when `requiredPolicies` is empty and every reported surface count is zero.

The plan covers the exact T040 content boundary:

| Report surface | Persisted state |
| --- | --- |
| `pages.content`, `pages.ydoc`, `pages.ydoc_decode_error` | Active and deleted page JSON and semantically decoded Yjs documents |
| `page_history.content`, `page_history.change_data` | Historical snapshots and change payloads |
| `page_transclusions.content` | Persisted synced-block content |
| `page_template_revisions.content` | Immutable template revisions |
| `page_template_operations.staged_content` | Staged template/legacy-operation content |
| `databases.description_content`, `database_cells.value` | Rich database descriptions and cells |
| `comments.content` | Rich comment content |
| `page_transclusion_references` | Retired whole-page reference shapes |
| `orphan_block_transclusion_references` | Block references whose source page no longer exists |
| `inconsistent_transclusion_references` | Cross-workspace or missing-consumer reference corruption |
| `pending_retired_operations` | Undrained retired operations |
| `failed_retired_cleanup_ledgers` | Failed operations that may be the only storage-cleanup evidence |

The Yjs test is semantic: ordinary text containing the word `pageEmbed` is not
a legacy node. A decode failure is reported separately and never treated as a
clean document.

Do not apply while `hardBlockerCount` is non-zero. Drain pending retired work
with the previous compatible release. Reconcile failed operation attachment
mappings/staged content against the verified backup and storage; never delete
those rows merely to pass T040. Repair inconsistent workspace/reference data
before retrying. If `pages.materialization_context_limit` is reported, reduce
the page batch or raise the explicit context limit after a capacity review.

## Select explicit policies

Use only policies justified by the plan. There is no implicit preservation
policy.

| Plan requirement | Accepted policy | Data boundary |
| --- | --- | --- |
| Page JSON or Yjs nodes | `--pages-policy=materialize-safe` | Copies current source content only when source and consumer share workspace/space, neither ancestry has page ACL rules, and the consumer ancestry has no applicable public share. Missing, cyclic, deleted, invalid, or over-depth sources become a deterministic unavailable callout. |
| Unsafe page audience or attachment ownership | `--unsafe-page-policy=neutralize` | Replaces the whole legacy node with a neutral callout. This is explicit data loss. |
| Undecodable Yjs with authoritative JSON | `--ydoc-decode-policy=rebuild-from-content` | Rebuilds Yjs from the stored JSON document. |
| Undecodable Yjs without JSON | `--ydoc-only-policy=clear` | Clears the unrecoverable Yjs payload. This is explicit data loss. |
| Page history | `--page-history-policy=neutralize` or `--page-history-policy=purge` | Neutralize preserves the surrounding historical record with callouts; purge deletes matching history rows in bounded transactions. Purge is irreversible without the backup. |
| Transclusion, template revision, staged-operation, database, cell, or comment rich JSON | The matching `--*-policy=neutralize` | Replaces only legacy nodes with a deterministic historical callout. It does not substitute current source content for historical truth. |
| Retired whole-page references | `--reference-policy=delete-after-clean` | Deletes derived reference rows only after every content surface verifies clean. |
| Orphan ordinary block references | `--orphan-reference-policy=delete-after-clean` | Deletes only derived rows whose source page is already absent, after content verification. |

Safe page materialization clones each source-owned attachment to a deterministic
consumer-owned attachment ID and path before updating the page. The durable
`page_embed_attachment_clone_ledger` records `pending`, `copied`, and
`completed` stages. A retry reuses the same ID and converges after a crash; it
does not share the source row across page ACLs. Missing, deleted, or foreign
attachment ownership requires the explicit unsafe-page neutralization policy.

## Apply

Always run apply after reviewing a clean, non-blocked plan. When
`requiredPolicies` is empty, run it without any surface-policy flags:

```bash
corepack pnpm --filter ./apps/server page-embed:prepare-removal -- \
  --apply --yes \
  --maintenance-ack=api-collab-workers-stopped \
  --backup-ack=<verified-backup-id> \
  --batch-size=100 \
  --context-page-limit=5000
```

When the plan reports retained state, copy its exact `requiredPolicies`. The
following example shows every policy; omit a policy only when its surface is
clean and the plan does not require it.

```bash
corepack pnpm --filter ./apps/server page-embed:prepare-removal -- \
  --apply --yes \
  --maintenance-ack=api-collab-workers-stopped \
  --backup-ack=<verified-backup-id> \
  --batch-size=100 \
  --context-page-limit=5000 \
  --pages-policy=materialize-safe \
  --unsafe-page-policy=neutralize \
  --ydoc-decode-policy=rebuild-from-content \
  --ydoc-only-policy=clear \
  --page-history-policy=neutralize \
  --page-transclusions-policy=neutralize \
  --template-revisions-policy=neutralize \
  --staged-operations-policy=neutralize \
  --databases-policy=neutralize \
  --database-cells-policy=neutralize \
  --comments-policy=neutralize \
  --reference-policy=delete-after-clean \
  --orphan-reference-policy=delete-after-clean
```

`--backup-ack` is an acknowledgement string, not a backup verifier. Supplying
it without an independently verified coordinated backup does not satisfy the
release contract. Each mutation transaction is bounded by `--batch-size`.
Content and rebuilt Yjs are written atomically per page batch. References are
removed only after a second content verification. The final step records exact
content and Yjs hashes for every page, including deleted pages, in
`page_embed_removal_ledger`.

If storage copying fails, keep maintenance active, correct the storage
configuration or availability, and rerun the same apply command. Do not delete
the clone ledger or deterministic destination files/rows. T040 refuses to run
while a clone is incomplete or while a completed destination row is missing,
deleted, or has inconsistent ownership/path metadata.

## Verify and migrate

Rerun the read-only plan with the same bounds. Before T040,
`legacySchemaPresent` remains `true`, but every surface count and
`hardBlockerCount` must be zero. Preserve both sanitized JSON reports in the
change record.

Then run the normal production migration operator from the same candidate.
T040 repeats every JSON/reference/operation predicate, verifies the exact page
hash ledger and completed attachment-clone ledger, restores the ordinary block
reference source-page foreign key, removes the retired schema, and drops both
temporary ledgers only after all checks pass.

If T040 fails, do not weaken its predicates and do not use blind row deletion.
Return to the plan, reconcile the reported surface under maintenance, and
rerun. If an applied policy was incorrect, restore the coordinated pre-upgrade
database and storage backup together. T040 `down` recreates empty compatibility
schema; it cannot reconstruct neutralized, purged, or materialized legacy data.

## Evidence boundary

Repository unit tests and a disposable PostgreSQL 18 fixture cover every T040
surface, semantic Yjs detection, bounded scans, source-owned image/file copies,
retry, final ledger verification, and the real T040 `up` function. They do not
prove a production backup, capacity review, maintenance fence, migration drill,
or environment-specific storage permissions. Record those separately.
