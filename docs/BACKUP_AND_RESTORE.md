# Backup and restore runbook

This runbook covers the repository Docker Compose stack with local file
storage. The supported archive is a coordinated PostgreSQL and storage-volume
snapshot created while the API and collaboration writers are stopped. Redis is
ephemeral recovery state and is deliberately recreated empty during restore.

The CLI uses Docker for `tar`, `pg_dump`, and `pg_restore`, so the same commands
work from Windows PowerShell and Linux shells. It resolves the concrete volume
names from the rendered Compose configuration and never accepts caller-supplied
volume names.

## Ownership and prerequisites

The operator running these commands owns the backup location, downtime window,
secret escrow, restore decision, and post-restore acceptance. Before starting:

- run from the repository root with Docker Engine available;
- use the same `--compose-file` and `--env-file` as the target deployment;
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
or optional provider credentials.

## Create and verify

Create a new archive:

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

`manifest.json` records the application version/revision/image, PostgreSQL dump
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
separately.

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
- whether optional outbound integrations remain disabled or were deliberately
  re-enabled from the target deployment's local configuration.

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
