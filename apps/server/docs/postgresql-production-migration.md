# PostgreSQL production migration runbook

This runbook is the supported PostgreSQL deployment and runtime migration path
for the Docmost production Compose stack. It deliberately does not repair a
collation warning in place. `ALTER ... REFRESH COLLATION VERSION` only updates
the recorded version and does not prove that dependent indexes and other
objects were rebuilt correctly.

The supported target is PostgreSQL 18 on the pinned Debian/glibc image in
`compose.production.yml`. Never attach an existing production volume to an
Alpine/musl PostgreSQL container. Any future PostgreSQL major, libc, locale, or
collation-provider change must use a new volume and logical dump/restore.

## Deployment files and ownership

The production host needs these files and resources:

- `/etc/docmost/docmost.env`: root-readable deployment configuration and
  secrets, based on `.env.production.example`. `DOCMOST_IMAGE` must include an
  immutable `@sha256:` digest.
- `/var/lib/docmost/deployment/postgres.env`: a non-secret, root-owned state
  file with mode `0600`.
- `/var/backups/docmost/postgres`: a root-owned backup directory on storage
  independent from the Docker volume being migrated.
- one external PostgreSQL volume and one external Docmost file-storage volume;
- the external ingress network named by `EDGE_NETWORK_NAME`;
- executable maintenance enter/exit hooks outside the repository.

An initial state file is:

```dotenv
POSTGRES_VOLUME_NAME=docmost_postgres_20260812
DOCMOST_STORAGE_VOLUME_NAME=docmost_storage
MIGRATION_PHASE=ready
```

Create both external volumes explicitly before the first deployment. PostgreSQL
18 data is mounted at `/var/lib/postgresql`, not
`/var/lib/postgresql/data`.

The maintenance hooks are invoked directly without a shell and receive only
`PATH`, `APP_URL`, `COMPOSE_PROJECT_NAME`, and `DOCMOST_MIGRATION_ID`. They must
be idempotent:

- `DOCMOST_MAINTENANCE_ENTER_HOOK` must make ingress return a static maintenance
  response and stop new WebSocket upgrades before it exits successfully.
- `DOCMOST_MAINTENANCE_EXIT_HOOK` must restore normal ingress routing. It is
  called only after the selected API and collaboration containers are healthy.

Do not put credentials in hook paths, arguments, output, or implementation.

## Startup contract

`compose.production.yml` enforces this dependency chain:

```text
PostgreSQL healthy
-> read-only database preflight
-> one-shot Kysely migration
-> collaboration healthy
-> API healthy
```

Both long-running application processes use
`DATABASE_MIGRATION_MODE=external`. They repeat preflight on startup, do not
apply schema changes, and do not become ready if runtime validation fails or
packaged migrations are pending/unknown. Local `docker-compose.yml` retains
`DATABASE_MIGRATION_MODE=auto` by default for development, but uses the same
Debian PostgreSQL image as production and CI.

## Preflight result contract

Run preflight against the currently selected volume:

```bash
corepack pnpm production:db -- preflight --json
```

The command emits one JSON report. It never emits the database URL, passwords,
tokens, or raw connection errors.

| Exit | Meaning                                                                                 | Operator action                             |
| ---: | --------------------------------------------------------------------------------------- | ------------------------------------------- |
|  `0` | PostgreSQL 18 GNU runtime, collations, indexes, topology, and migration prefix are safe | Continue                                    |
| `20` | Physical volume must not be reused on this runtime                                      | Run the logical migration pipeline          |
| `30` | Unsupported or unknown topology/state                                                   | Stop and involve a DBA                      |
| `40` | Unknown, duplicated, out-of-order, or still-pending migration history                   | Stop and reconcile code/database provenance |

Exit `20` includes a major/runtime or used-collation mismatch. Exit `30`
includes an unknown runtime, invalid index, read-only/recovery server,
additional application databases or login roles, non-default tablespaces,
subscriptions, or replication slots. The supported Compose topology has one
application database and no auxiliary login roles.

Preflight never runs `REFRESH COLLATION VERSION`, `REINDEX`, migration SQL, or
any other write.

## Read-only plan and rehearsal

Record the measured end-to-end restore duration from a current production-copy
rehearsal as `POSTGRES_REHEARSAL_SECONDS` in the deployment environment. Then
run:

```bash
corepack pnpm production:db -- plan --json
```

The plan checks the source preflight, database and file-volume sizes, free space
in both the backup filesystem and Docker root, and reports a conservative
downtime estimate. A blocked plan must not be overridden. Increasing capacity
or moving the backup directory is safer than weakening the thresholds.

## Migration

Before the maintenance window:

1. Pin the candidate `DOCMOST_IMAGE` by digest and keep the currently running
   digest locally available for rollback.
2. Complete `corepack pnpm verify:release` against the release candidate.
3. Rehearse this exact operation on a current copy of production.
4. Confirm the old PostgreSQL volume has never been started with Alpine/musl.
5. Make an off-host copy of the backup after it is created.
6. Confirm the Draw.io release gate and every other release blocker separately.

Start the migration:

```bash
corepack pnpm production:db -- migrate --yes --json
```

The operator performs these fail-closed steps:

1. invokes the maintenance enter hook and stops API/collaboration writers;
2. rejects remaining database connections and records a source inventory;
3. creates a custom-format `pg_dump`, a compressed file-volume snapshot,
   SHA-256 hashes, sizes, runtime versions, and an object manifest;
4. validates the dump before creating a labelled candidate PostgreSQL volume;
5. restores with `pg_restore --exit-on-error --no-owner --no-acl`;
6. compares exact table row counts, sequence values, extension versions, large
   object count, constraint definitions, index definitions, and invalid state;
7. runs the one-shot Kysely migration, `ANALYZE`, and require-latest preflight;
8. atomically replaces the deployment state file, then starts PostgreSQL,
   collaboration, and API in that order;
9. leaves ingress in maintenance mode and state in `acceptance`.

The backup directory and source volume are never automatically deleted. Keep
them for at least 14 days and until an independent restore has been verified.
If a dump is corrupt, disk space is insufficient, restore is interrupted,
inventory differs, or postflight fails, the candidate is not selected. The
operator restores the previous image/volume pair and reopens ingress only after
both old application processes are healthy.

## Acceptance and rollback boundary

While state is `acceptance` and ingress is still closed, verify:

- PostgreSQL, collaboration, and API health endpoints return `200`;
- sign-in works;
- an existing page can be read, edited, saved, and reloaded;
- attachment upload and download work;
- live collaboration/WebSocket updates work from two sessions;
- Draw.io loads and an edit can be saved;
- database logs remain free of collation-version warnings for 30 minutes.

If any check fails, roll back before admitting writes:

```bash
corepack pnpm production:db -- rollback --yes --json
```

Rollback selects the previous volume, validates it, starts PostgreSQL,
collaboration, and API, and invokes the maintenance exit hook. It does not
delete the failed candidate or its backup.

After all acceptance checks pass, open ingress and seal the rollback boundary:

```bash
corepack pnpm production:db -- accept --yes --json
```

`accept` performs one last health/preflight check, invokes the maintenance exit
hook, and changes state to `accepted`. Automatic rollback is forbidden after
this point because the old volume no longer contains writes admitted after
cutover. Recovery after acceptance requires a new planned migration or a
DBA-approved point-in-time recovery procedure.

## Failure handling

- Never edit `POSTGRES_VOLUME_NAME` while Compose processes are running.
- Never reuse a partially restored candidate volume. The pipeline creates a new
  name on every attempt.
- Do not run `migration:down` as a substitute for volume rollback; down
  migrations may be destructive.
- An unknown migration, extra role/database/tablespace, replication state, or
  invalid index is a DBA boundary, not an operator override.
- Keep the maintenance route closed if either old or new application health is
  uncertain.
- Treat stdout, manifests, and CI artifacts as publishable operational data;
  secret scanning is a blocking CI check.

The PostgreSQL image/digest contract is checked by
`corepack pnpm check:production-db`. CI also clones a Debian-created physical
volume into an Alpine runtime and proves preflight exits `20`, then performs a
fresh Debian dump/restore, rejects a corrupt/interrupted restore, reruns schema
migration idempotently, validates data, and starts both application processes
in external migration mode.
