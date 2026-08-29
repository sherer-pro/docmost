# Search architecture and operations

PostgreSQL is the source of truth for search. Typesense is an optional,
rebuildable candidate index: every Typesense hit is reloaded from PostgreSQL
and checked against the current workspace, space, page, and share policy before
it can be returned.

## Search surfaces

Authenticated Spotlight starts in `All` mode and runs three independent
requests, with five results per section:

- `POST /api/search` for documents, databases, and database rows;
- `POST /api/search/attachments` for attachment names and extracted content;
- `POST /api/search/dictionary` for terms, forms, and definitions.

Dictionary results are available only in active spaces where Dictionary is
enabled and the caller can read at least one page. Full forms and the Markdown
definition are loaded on demand from `GET /api/dictionary-terms/:termId`.
Public share search remains page-only and never includes Dictionary terms or
database-cell projections.

Database-row search indexes only display values from `multiline_text`, `code`,
`select`, and `user` cells. Select labels and current user display names are
used. Property names appear only in result snippets. Checkbox values, page
references, UUID-only values, and serialized objects/arrays are excluded. One
cell is limited to 20 KB and one row projection to 1 MB.

## Drivers and fallback

`SEARCH_DRIVER=database` searches PostgreSQL directly. Cell edits update the
row projection in the same transaction, so committed changes are immediately
searchable. Property/select-option changes, user display-name changes, copies,
and imports enqueue projection rebuilds.

`SEARCH_DRIVER=typesense` uses Typesense for candidate generation. Lifecycle
jobs normally update it within seconds, and a deterministic reconciliation job
runs every 15 minutes. A Typesense network error, timeout, HTTP `404`, `429`, or
`5xx` response falls back to PostgreSQL for that request. Authentication,
malformed-query, and schema errors are returned instead of being masked.

Search logs never contain query text. Structured events report fallback entity
and reason, search and reconciliation duration, queue depth, alias switches,
and reconciliation count mismatches.

## Deploy Typesense beside Docmost

Run Typesense as a separate container on the same private Compose network, not
inside the Docmost application container. Keep port `8108` private unless an
operator explicitly needs host access. Put a long random `TYPESENSE_API_KEY` in
the same `.env` file used as the source of the existing
`docmost_typesense_api_key` Compose secret, then set:

```dotenv
SEARCH_DRIVER=typesense
TYPESENSE_URL=http://typesense:8108
TYPESENSE_API_KEY=<long-random-key>
TYPESENSE_LOCALE=en
```

Production uses the checked-in `compose.typesense.yml` overlay together with
`compose.production.yml`. The pinned image is the same generation exercised by
CI. The overlay keeps port `8108` private, runs with a read-only root
filesystem, drops all capabilities, rotates logs, and caps Typesense at 512 MiB,
one CPU, and 256 processes. The explicit eight-thread pool keeps that PID cap
portable to hosts with a high visible CPU count. Do not force an arbitrary
numeric UID until the official image has been tested against the real data volume.

The canonical overlay contains:

```yaml
services:
  typesense:
    image: typesense/typesense:30.2@sha256:610f2d34b1f93d00762869da2c67736775e5798d19a2c8b91b014b8a0cc1e110
    entrypoint: ["/bin/sh", "-c"]
    command:
      - >-
        exec /opt/typesense-server
        --data-dir=/data
        --api-key="$$(cat /run/secrets/docmost_typesense_api_key)"
        --enable-cors=false
        --thread-pool-size=8
    secrets:
      - docmost_typesense_api_key
    volumes:
      - typesense_data:/data
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    mem_limit: 512m
    cpus: "1.0"
    pids_limit: 256
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"
    healthcheck:
      test: ["CMD-SHELL", "bash -c 'exec 3<>/dev/tcp/127.0.0.1/8108'"]
      interval: 10s
      timeout: 5s
      retries: 12

  docmost:
    depends_on:
      typesense:
        condition: service_healthy
    environment:
      TYPESENSE_API_KEY_FILE: /run/secrets/docmost_typesense_api_key
    secrets:
      - docmost_typesense_api_key

  collab:
    environment:
      TYPESENSE_API_KEY_FILE: /run/secrets/docmost_typesense_api_key
    secrets:
      - docmost_typesense_api_key

volumes:
  typesense_data:
```

Render the complete production topology, then start and verify the sidecar
before recreating the application processes:

```bash
docker compose \
  --env-file /etc/docmost/docmost.env \
  --env-file /var/lib/docmost/deployment/postgres.env \
  -f compose.production.yml \
  -f compose.typesense.yml \
  config --quiet
docker compose -f compose.production.yml -f compose.typesense.yml up -d typesense
docker compose -f compose.production.yml -f compose.typesense.yml ps typesense
docker compose -f compose.production.yml -f compose.typesense.yml up -d docmost collab
```

Then queue the initial projection rebuild with the command in the Reindex
section. When running only the production image, the equivalent in-container
command is:

```bash
docker compose \
  --env-file /etc/docmost/docmost.env \
  --env-file /var/lib/docmost/deployment/postgres.env \
  -f compose.production.yml \
  -f compose.typesense.yml \
  exec docmost node \
  apps/server/dist/apps/server/src/cli/search-reindex.js \
  --workspace=all \
  --entities=pages,attachments,dictionary
```

The production CLI resolves `DATABASE_URL_FILE` and `REDIS_URL_FILE` from the
mounted Compose secrets. Do not copy either connection string into the command
line or inject it with `docker compose exec -e`.

Do not publish `8108`, reuse the Typesense admin key in browser code, or depend
on the Typesense volume for recovery. Size memory and disk from a representative
rebuild of the real dataset, keep headroom for a second physical generation
during upgrades, and alert on container health plus the structured search
events described above.

## Collections and aliases

Stable aliases isolate clients from physical generations:

| Alias                      | Current physical generation   |
| -------------------------- | ----------------------------- |
| `docmost_pages`            | `docmost_pages_v3`            |
| `docmost_attachments`      | `docmost_attachments_v2`      |
| `docmost_dictionary_terms` | `docmost_dictionary_terms_v1` |

Pages search `title,content,databaseContent` with weights `8,3,2`.
Dictionary terms search `term,forms,definitionText` with weights `8,6,1`;
typos are disabled for definitions.

An unscoped full rebuild loads the physical generations, removes stale
documents, compares Typesense counts with PostgreSQL, reads representative
documents, and only then switches the aliases. The prior page generation is
retained for 24 hours. To roll back during that window, update the
`docmost_pages` alias through the Typesense aliases API so its
`collection_name` is `docmost_pages_v2`. Investigate and correct the failed
generation before rebuilding again.

## Reindex

Queue a full rebuild for all workspaces:

```bash
corepack pnpm --filter ./apps/server search:reindex -- \
  --workspace=all \
  --entities=pages,attachments,dictionary
```

For one workspace, pass its UUID. Including `pages` also rebuilds derived
database-row projections. Redis job IDs make equivalent concurrent rebuild
requests idempotent across application instances. Use
`--reextract-attachments` only when attachment text itself must be regenerated;
`--retry-failed` additionally retries failed extraction and requires that flag.

After an initial Typesense deployment or schema upgrade, monitor the search
queue, wait for the alias-switch events, verify representative queries with
both drivers, and retain the old generation until the 24-hour rollback window
has elapsed.

## Backup and recovery

Typesense is deliberately absent from the required backup set. Restore
PostgreSQL and file storage, start Redis empty, then run `search:reindex` to
rebuild database-row projections and every Typesense collection. Loss of
Typesense therefore reduces search performance during rebuilding but does not
lose authoritative Docmost data.
