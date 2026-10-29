# Backup and restore runbook

This runbook covers coordinated local-file-storage backups for development
Compose and the production deployment-state workflow. The supported archive is
a coordinated PostgreSQL and storage-volume
snapshot created while the API and collaboration writers are stopped. Redis is
ephemeral recovery state and is deliberately recreated empty during restore.

The CLI uses Docker for `tar`, `pg_dump`, and `pg_restore`, so the same commands
work from Windows PowerShell and Linux shells. It resolves the concrete volume
names from the rendered Compose configuration and never accepts caller-supplied
volume names.

The CLI creates its working directories as the invoking operator with mode
`0700` and streams container output into operator-owned files with mode `0600`.
Archive extraction follows the same rule, so a non-root Linux operator does
not need access to root-owned host files. Windows uses the operator's existing
filesystem ACLs. Storage helpers retain root access inside the container to
read restricted source-volume files without changing their permissions.
Restore waits for the final PostgreSQL TCP listener after initialization;
the entrypoint's temporary Unix-socket-only server is not accepted as ready.

## Ownership and prerequisites

The operator running these commands owns the backup location, downtime window,
secret escrow, restore decision, and post-restore acceptance. Before starting:

- run from the repository root with Docker Engine available;
- use every runtime `--env-file` and `--compose-file` from the target deployment,
  in their original order; production additionally requires `--state-file`;
- confirm `STORAGE_DRIVER=local`; S3 storage needs an independent bucket
  snapshot and is rejected by this workflow;
- keep `APP_SECRET`, `COLLAB_INTERNAL_SECRET`, `POSTGRES_PASSWORD`, and any
  optional integration credentials in a separate secret manager;
- choose an absolute archive path outside the repository with enough free
  space for the dump, compressed storage, and outer archive;
- announce a write outage. `create` stops `docmost` and `collab`, waits for
  application database sessions to drain, and restores their prior running
  state in a `finally` path.

The archive never contains `.env`, Compose files, Docker secrets, Redis data,
Typesense collections, or optional provider credentials. Typesense is a
rebuildable projection of PostgreSQL; after restore, use
`search:reindex -- --workspace=all --entities=pages,attachments,dictionary` as
documented in [the search runbook](./SEARCH.md).

## Production inputs and recovery boundary

Run from the exact release checkout. Repeat `--env-file` for ordered runtime
inputs and `--compose-file` for ordered manifests/overlays. `--state-file` is
separate, contains no credentials, and is passed to Compose after the runtime
env inputs regardless of its CLI position. Repeating `--state-file` is rejected.
Relative paths retain Compose semantics: the first Compose file defines the
project directory. No temporary merged env or flattened manifest is used.

Use the production runtime configuration and state described in
[deployment](./DEPLOYMENT.md) and the
[PostgreSQL migration runbook](../apps/server/docs/postgresql-production-migration.md).
Example production backup inputs are:

```bash
corepack pnpm backup -- create \
  --archive /absolute/off-host-staging/docmost-coordinated.tar \
  --env-file /etc/docmost/docmost.env \
  --state-file /var/lib/docmost/deployment/postgres.env \
  --compose-file compose.production.yml \
  --compose-file compose.typesense.yml \
  --yes
```

Include Typesense only when enabled and append every mandatory host overlay in
its original order. The paths above are runbook defaults, not an installation
snapshot. The defaults `.env` and `docker-compose.yml` still select development.
State must select PostgreSQL/storage volumes and a `ready` or `accepted`
`MIGRATION_PHASE`. Conflicting shell overrides, secret-bearing state keys,
missing inputs, shared/mismatched service mounts, and missing source volumes
fail before writers are stopped. All three source volumes must be distinct,
ordinary local Docker volumes. Missing source storage is never implicitly
created by a read-only helper mount.

Backup and migration CLIs share an exclusive lock adjacent to the canonical
state file (`<state-file>.operation.lock`). A concurrent operation fails closed;
an existing lock is never stolen or automatically expired. After a crashed
process, verify the owner and absence of active operations before a separately
authorized stale-lock removal. External host tools must participate in this
contract or remain inactive; this file lock does not coordinate arbitrary
third-party scripts.

Production restore is a data-plane operation with ingress already closed. It
requires `--replace --yes --no-start --maintenance-confirmed`, the same ordered
inputs, and an explicitly selected state file. Verify the archive first:

```bash
corepack pnpm backup -- verify --archive /absolute/off-host-staging/docmost-coordinated.tar --json
corepack pnpm backup -- restore \
  --archive /absolute/off-host-staging/docmost-coordinated.tar \
  --env-file /etc/docmost/docmost.env \
  --state-file /var/lib/docmost/deployment/postgres.env \
  --compose-file compose.production.yml \
  --compose-file compose.typesense.yml \
  --replace --yes --no-start --maintenance-confirmed
```

The configured application image must match the archive image. Keep that
immutable image available locally; restore does not pull a replacement. The CLI
validates the archive before stopping services, then creates fresh external
PostgreSQL, storage, and Redis candidate volumes. It never deletes the original
production volumes. A temporary volume-only overlay selects candidates while
the protected runtime inputs remain untouched. No migration or application
process is started by this restore path.

After actual `pg_restore`, planner analysis, and storage extraction, the CLI
checks row counts, migration boundary, storage inventory, and access by the
API/collaboration runtime UID/GID. Ownership is restored to that identity and
owner read/write/directory-search rights are ensured without granting world
access. API and collaboration must share the storage identity. On failure,
original state/volumes are retained, candidate database/Redis services are
removed, and previously running source services are resumed without migration
or image pull. A failure to resume is reported; keep ingress closed and use the
retained source volumes and state for recovery.

On success, the state is switched atomically to all three candidate volumes.
`MIGRATION_PHASE`, image fields, and other existing state are preserved; a
root-readable `before-restore` state file records the rollback input.
`RESTORE_PHASE=awaiting-acceptance` makes pending acceptance explicit. Only
database/Redis are left running. PostgreSQL migration mutations and another
backup/restore are blocked until the operator accepts the application; read-only
database preflight remains available.

With ingress closed, perform the exact release's readiness and authenticated
application acceptance, including attachment writes, collaboration, and a
Typesense rebuild/search when enabled. Backup CLI checks do not establish those
results. Stop writers before changing protected state, record the acceptance,
and set `RESTORE_PHASE=accepted` through an atomic owner-controlled state update;
resume the accepted services before reopening ingress. Before accepting new
writes, rollback can select the retained `before-restore` state and original
volumes. After accepting writes, do not roll back to the old volumes: they lack
the new writes. Retain both state/volume sets under the deployment owner's
policy and perform any eventual deletion separately.

On a cold host with no original volumes, supply valid deployment state and
`--no-snapshot` explicitly. Only fresh candidate volumes are created; nonexistent
source names are not materialized. The default pre-restore snapshot requires an
existing running source database/Redis and source storage. Runtime secrets,
images, external ingress network, and any enabled Typesense volume/credential
must be provisioned independently. This CLI is not an infrastructure installer.

Legacy archives are not accepted by the production state workflow. Restore
them first in an isolated compatible environment, inspect their migration
boundary, then create a v1 archive with the approved application image. In the
development legacy workflow, `APP_SECRET` is updated only in the last runtime
input that defines it (or the last runtime input if none does), never in state.
A shell `APP_SECRET` override is rejected for that import.

Archive-only `verify` does not load deployment env/state or render Compose. It
uses temporary Docker helpers and does not stop or restore applications. Docker,
the pinned helper image, temporary capacity, and an absolute archive outside the
repository are still required. The exact isolated contract test is
`corepack pnpm test:backup:e2e`; it uses production Compose plus the canonical
Typesense overlay and synthetic lifecycle fixtures, real data services, fresh
volumes, and no published ports. It verifies data-plane recovery and failure
rollback, not production application acceptance, RPO/RTO, or off-host durability.

## Create and verify

Create a new archive of the supported development stack:

```bash
corepack pnpm backup -- create \
  --archive /absolute/off-host-staging/docmost-2026-08-15.tar \
  --env-file .env \
  --yes
```

On PowerShell, use a Windows absolute path and one line or PowerShell
backticks. The destination must not already exist. The CLI writes payloads to
a sibling working directory, validates the completed `.part` archive, and only
then atomically renames it to the requested path.

The exact outer member set is:

- `manifest.json`;
- `postgres.dump`;
- `storage.tar.gz`.

`manifest.json` records the application image identity and OCI version/revision
labels (explicitly `unknown` when absent), separate tool checkout provenance, PostgreSQL dump
metadata, migration boundary, non-sensitive row counts, storage file/byte/path
inventory, and SHA-256 plus size for both payloads. It explicitly records that
secrets and Redis are absent.

Verify an archive without changing Compose state:

```bash
corepack pnpm backup -- verify \
  --archive /absolute/off-host-staging/docmost-2026-08-15.tar \
  --json
```

Verification is fail-closed. It checks the exact outer member set, rejects
absolute/traversal/duplicate paths and links or device entries, compares the
manifest payload sizes and hashes, runs `pg_restore --list`, fully decodes the
dump to `/dev/null`, and validates every storage entry before extraction.

Copy a verified archive off-host and record the outer-file SHA-256. A successful
create on the same machine is not off-host durability evidence.

## Restore

Restore is destructive and requires both `--replace` and `--yes`. By default it
first creates a sibling pre-restore snapshot. Its secrets must still be kept
separately. The following example is for development-managed volumes, not the
production external-volume topology described above.

```bash
corepack pnpm backup -- restore \
  --archive /absolute/off-host-staging/docmost-2026-08-15.tar \
  --env-file .env \
  --replace \
  --yes
```

Use `--snapshot-archive ABSOLUTE_PATH` to control the pre-restore snapshot
location. `--no-snapshot` is an explicit acknowledgement that the current
database, storage, and Redis volumes may be discarded without a recovery point.

Restore validates the source before any destructive action, stops the Compose
project, removes only the three volume names resolved from Compose, starts a
fresh PostgreSQL/Redis pair, restores the custom dump with `--exit-on-error`,
rebuilds PostgreSQL planner statistics with `vacuumdb --analyze-in-stages`,
extracts validated storage into a new volume, and starts the ordinary stack.
Redis always starts empty. If database or storage restore fails, the CLI removes
the partial candidate volumes instead of leaving them available for reuse.

Use `--no-start` when an operator must boot an older application image against
its exact migration boundary before upgrading. After that compatibility check,
run the normal migration path for the target release and start Compose normally.

## Legacy archives

The verifier recognizes the former exact member set `.env`,
`docker-compose.yml`, `postgres.dump`, and `storage.tar`. The archived Compose
file is never executed. Legacy storage must be rooted under exactly one
`storage/` prefix, which is stripped on extraction.

Legacy restore requires `--allow-legacy-env`. This imports only `APP_SECRET`
into the selected local env file because encrypted database values depend on it.
Every other archived environment value, including SMTP, VAPID, S3, AI, RAG,
SSO, MCP, proxy, and public-origin settings, is ignored. Preserve the replaced
local `APP_SECRET` separately if a pre-restore snapshot may need it.

```bash
corepack pnpm backup -- restore \
  --archive C:\\backups\\legacy-docmost.tar \
  --env-file .env \
  --allow-legacy-env \
  --no-snapshot \
  --no-start \
  --replace \
  --yes
```

Start restored legacy data first with the exact application release that owns
the dump migration boundary. Keep outbound integrations disabled during that
first boot. Upgrade only after health, row counts, migration count, storage
inventory, and authenticated UI access are accepted.

## Acceptance and failure handling

After restore, record:

- HTTP `200` from API and collaboration health endpoints;
- all Compose service health states;
- expected migration count and latest migration name;
- user, space, page, and attachment counts compared with the manifest or
  legacy inventory;
- storage regular-file count and representative attachment reads;
- authenticated UI login and representative page rendering;
- completed database-row projection and Typesense rebuild, when Typesense is
  enabled, followed by representative document, attachment, and Dictionary
  searches;
- whether optional outbound integrations remain disabled or were deliberately
  re-enabled from the target deployment's local configuration.

For a disposable or forensic restore drill, stop every temporary application
and PostgreSQL container after recording acceptance evidence. Verify that it is
absent from `docker ps`; leaving a forensic database running consumes production
memory and can be mistaken for an owned Compose service. Preserve the stopped
container and candidate volume when retention or incident evidence requires it,
and remove them only in a separate reviewed cleanup after the retention window.

Do not reuse partial volumes, do not substitute an Alpine/musl PostgreSQL image
for the pinned Debian/glibc runtime, and do not open ingress while migration or
acceptance is incomplete. If a default pre-restore snapshot exists, restore it
with its separately escrowed secrets. With `--no-snapshot`, recovery is possible
only from another verified archive.

RPO and RTO are deployment decisions, not properties of this CLI. Define a
backup schedule and maximum acceptable data loss, then measure the complete
create, off-host copy, restore, migration, and acceptance duration on a current
production-sized rehearsal. This local runbook does not prove hosted storage,
capacity, network ingress, or production rollback readiness.
