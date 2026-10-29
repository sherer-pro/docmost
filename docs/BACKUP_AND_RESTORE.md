# Backup and restore runbook

The executable create/restore examples in this runbook cover the repository
development Docker Compose stack with local file storage. The supported archive
is a coordinated PostgreSQL and storage-volume
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
- use the same `--compose-file` and `--env-file` as the target development stack;
  production has additional requirements and is blocked as described below;
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

## Production contract and current CLI limitation

Production uses the exact release's `compose.production.yml`, its required
overlays, runtime configuration, and a separate deployment state file. Follow
[deployment](./DEPLOYMENT.md) and the
[PostgreSQL migration runbook](../apps/server/docs/postgresql-production-migration.md)
for their ownership and compatibility boundaries. Keep installation records in
the [private operations store](./OPERATIONS.md#private-operator-store).

As checked against `scripts/backup.mjs` on 2026-10-29, `--env-file` and
`--compose-file` each accept **one** file. Repeating either option replaces the
previous value; it does not build the ordered Compose input set.
`--state-file` is rejected as an unknown argument. The defaults `.env` and
`docker-compose.yml` select development configuration.

Consequently, do not use the current CLI's `create` or `restore` against the
production stack. In particular:

- passing only the production runtime env omits the state-selected PostgreSQL
  and storage volume names;
- passing only the state file omits runtime configuration and credentials;
- passing only `compose.production.yml` omits Typesense and any mandatory
  deployment-owned overlays;
- restore deletes the resolved volumes and immediately starts `db` and `redis`.
  Production PostgreSQL and file storage use external volumes; the CLI has no
  step to recreate the external PostgreSQL volume before that start.

A merged temporary env, shell-exported state, a development Compose file, or
a flattened manifest is not a supported production workaround. Those approaches
also risk changing interpolation, relative paths, secret sources, or migration
and rollback boundaries.

For **configuration validation only**, Compose itself supports the ordered input
set. Run from the exact release checkout on the authorized operator host:

```bash
docker compose \
  --env-file /etc/docmost/docmost.env \
  --env-file /var/lib/docmost/deployment/postgres.env \
  -f compose.production.yml \
  -f compose.typesense.yml \
  config --quiet
```

Include `compose.typesense.yml` only when `SEARCH_DRIVER=typesense`; append every
mandatory host overlay in its original order. `config --quiet` must exit zero
without rendering secrets. Missing variables or invalid input are stop
conditions. This validates configuration and does not prove volume existence,
archive integrity, backup creation, or restore readiness. Do not run lifecycle
commands as part of this check. The paths above are runbook defaults, not a
claim about any installed host.

The archive-only `verify --archive ABSOLUTE_PATH --json` command below is
independent of the deployment input set. It uses temporary Docker helpers and
does not stop or restore the application. It still requires Docker, available
helper images, and sufficient temporary space; it is not an application drill.

The minimal proposed CLI change is ordered, repeatable `--env-file` and
`--compose-file` inputs with explicit state support and validation, preserving
Compose precedence and relative-path semantics. Production restore additionally
needs an explicit external-volume recovery contract, migration/ingress controls,
and a disposable rehearsal that verifies failure recovery. Argument parsing
alone does not make it safe. These are follow-up implementation requirements;
this documentation change does not implement or validate them. Until then,
operators must resolve the production backup/recovery prerequisite with the
deployment owner before proceeding with an upgrade. The `production:db` workflow
is not a replacement for a coordinated PostgreSQL-plus-storage backup.

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
