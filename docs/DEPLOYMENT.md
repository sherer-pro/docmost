# Production deployment

This is the canonical deployment entry point for the Docmost fork. The root
`docker-compose.yml` is for local development only. Production deployments use
`compose.production.yml`, the optional checked-in `compose.typesense.yml`, an application image pinned by registry digest,
external PostgreSQL and file-storage volumes, and an external ingress network.

Use this guide together with:

- the [PostgreSQL production migration runbook](../apps/server/docs/postgresql-production-migration.md)
  for database preflight, migration, acceptance, and rollback;
- the [backup and restore runbook](./BACKUP_AND_RESTORE.md) for coordinated
  PostgreSQL and local-file-storage recovery;
- the release notes for every version crossed during an upgrade;
- the [search runbook](./SEARCH.md) when Typesense is enabled.

The upstream Docmost installation guide describes a different image and
Compose topology. Do not use it as the production deployment procedure for
this fork.

## Prerequisites

The production host needs:

- Linux with Docker Engine and the Docker Compose v2 plugin;
- the repository checkout for the exact release being deployed;
- Node.js 22 and Corepack for the `production:db` operator commands;
- a reverse proxy or ingress that terminates HTTPS and supports WebSocket
  upgrades;
- root-owned locations for configuration, deployment state, and backups;
- storage outside the PostgreSQL volume for migration backups.

Run all repository commands below from the exact release checkout. Do not
deploy a moving branch or the `latest` tag.

## 1. Pin the release image

The release tag must be `v${package.version}`. The published application image
uses the version without the leading `v`. For example, release `v1.2.1`
publishes `shererpro/docmost:1.2.1`.

Pull the versioned image and resolve its immutable repository digest:

```bash
docker pull shererpro/docmost:1.2.1
docker image inspect \
  --format '{{range .RepoDigests}}{{println .}}{{end}}' \
  shererpro/docmost:1.2.1
```

Set `DOCMOST_IMAGE` to the returned
`shererpro/docmost@sha256:<digest>` value. `compose.production.yml` rejects a
tag-only application reference during startup.

## 2. Install configuration and deployment state

Create the root-owned directories:

```bash
sudo install -d -m 0750 /etc/docmost
sudo install -d -m 0700 /var/lib/docmost/deployment
sudo install -d -m 0700 /var/backups/docmost/postgres
```

Install the template and edit every placeholder without printing secrets to
the terminal or shell history:

```bash
sudo install -m 0600 .env.production.example /etc/docmost/docmost.env
sudoedit /etc/docmost/docmost.env
```

At minimum, set the immutable `DOCMOST_IMAGE`, public `APP_URL` and
`COLLAB_URL`, controlled `TRUSTED_PROXIES`, ingress network, independent
application/collaboration secrets, and matching PostgreSQL password and
`DATABASE_URL`. Keep this file root-readable only.

Create the non-secret deployment state file:

```dotenv
POSTGRES_VOLUME_NAME=docmost_postgres_20260821
DOCMOST_STORAGE_VOLUME_NAME=docmost_storage
MIGRATION_PHASE=ready
```

Save it as `/var/lib/docmost/deployment/postgres.env`, owned by root with mode
`0600`. The `production:db` tooling updates this file atomically. Never edit it
while the production Compose stack is running.

## 3. Prepare persistent resources and ingress

Create the external volumes named in the deployment state file:

```bash
docker volume create docmost_postgres_20260821
docker volume create docmost_storage
```

Create the external ingress network if it is not already managed by the
reverse-proxy stack:

```bash
docker network create edge
```

Configure ingress before admitting traffic:

- route `APP_URL` to `docmost:3000` on the external network, or to the API's
  loopback-bound host port;
- route `COLLAB_URL` to `collab:3001` and preserve WebSocket upgrades;
- terminate TLS for both public origins;
- set `TRUSTED_PROXIES` only to the ingress addresses or CIDRs you control.

The production Compose file requires the external network even when ingress
uses the loopback-bound host ports.

Production database migrations also require executable, idempotent maintenance
enter/exit hooks configured through `DOCMOST_MAINTENANCE_ENTER_HOOK` and
`DOCMOST_MAINTENANCE_EXIT_HOOK`. Implement and rehearse them before the first
upgrade. Follow the PostgreSQL runbook when a legacy topology also requires
`DOCMOST_ROLLBACK_HOOK`.

## 4. Validate and start a clean installation

Render the effective configuration before creating containers:

```bash
docker compose \
  --env-file /etc/docmost/docmost.env \
  --env-file /var/lib/docmost/deployment/postgres.env \
  -f compose.production.yml \
  config --quiet
```

Start the production stack:

```bash
docker compose \
  --env-file /etc/docmost/docmost.env \
  --env-file /var/lib/docmost/deployment/postgres.env \
  -f compose.production.yml \
  up -d
```

The enforced startup order is PostgreSQL health, image/database preflight,
one-shot schema migration, collaboration health, and API health. The API and
collaboration services run with `DATABASE_MIGRATION_MODE=external`; they never
apply migrations themselves.

Each long-running application container starts a first-party Node.js supervisor
as PID 1 and one API or collaboration child. The supervisor probes
`/api/health/live` every five seconds with a two-second timeout and a 60-second
startup grace. Three consecutive failures terminate only that child/container;
Compose `restart: unless-stopped` then restores the affected service without
restarting the other application process, PostgreSQL, or Redis. The supervisor
forwards an external `SIGTERM` or `SIGINT` and does not shorten the application's
ordinary graceful shutdown.

`/api/health/live` is process liveness only. Compose and ingress readiness must
continue to use `/api/health`, which verifies PostgreSQL and Redis. Do not route
traffic based only on liveness.

Inspect the completed one-shot services and long-running health state:

```bash
docker compose \
  --env-file /etc/docmost/docmost.env \
  --env-file /var/lib/docmost/deployment/postgres.env \
  -f compose.production.yml \
  ps -a
```

Do not treat a successful image pull or build as startup evidence. Confirm that
`image-preflight`, `db-preflight`, and `db-migrate` exited successfully, both
long-running application services are healthy, `/api/health` returns `200`,
both PID 1/child process trees are present, the setup/sign-in flow works, and
collaboration connects through its public origin before opening general ingress.
The immutable-image CI recovery smoke is the fault-injection evidence; do not
repeat `SIGSTOP` fault injection in production.

## 5. Upgrades and rollback

Before an upgrade:

1. Read every intervening release note and pin the candidate image by digest.
2. Create and verify a coordinated backup.
3. Keep the previous application digest and PostgreSQL volume available.
4. Rehearse the exact change against a current production copy.
5. Run `corepack pnpm verify:release` against the candidate environment.
6. Run `corepack pnpm production:db -- preflight --json` and then
   `corepack pnpm production:db -- plan --json`.

Perform the change only through the documented migration workflow:

```bash
corepack pnpm production:db -- migrate --yes --json
```

The command leaves ingress closed and the deployment state in `acceptance`.
Complete the release-specific acceptance checks, then either roll back before
admitting writes or accept the deployment:

```bash
corepack pnpm production:db -- rollback --yes --json
corepack pnpm production:db -- accept --yes --json
```

After `accept`, automatic volume rollback is forbidden because the old database
does not contain newly accepted writes. Use a planned forward migration or a
DBA-approved recovery procedure instead.

## Canonical Typesense overlay and host-specific overlays

When `SEARCH_DRIVER=typesense`, always include the repository-owned
`compose.typesense.yml` in every `config`, `up`, `exec`, and `ps` command. It is
the canonical production definition for the Typesense service and its
application secret mount, limits, healthcheck, security controls, and log
rotation. The detailed operating procedure is in the search runbook.

Resource-limit, proxy, and monitoring overlays are deployment-owned files, not
generic release artifacts. If a host requires an additional Compose file, keep
it in the protected operations source for that host, copy it into the versioned
release directory, and include it in both `config` and lifecycle commands.

Never silently omit a mandatory host overlay. Validate the merged effective
configuration before the maintenance window. Do not substitute the local
`docker-compose.yml` for `compose.production.yml`.

## Verification boundary

Repository contract checks validate the checked-in topology and configuration:

```bash
corepack pnpm check:env
corepack pnpm check:production-db
corepack pnpm check:release-version
```

They do not prove registry publication, production capacity, host permissions,
ingress/TLS behavior, external integrations, a real upgrade, or rollback. Keep
that evidence with the deployment record.
