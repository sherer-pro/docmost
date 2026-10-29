# Operations ownership and evidence

Docmost owns its application deployment contract, recovery requirements,
installation state, and application acceptance history. Shared ingress,
host/VPN/SSH policy, backup transport, export filters, retention locks, and PC
mirror generations remain with their infrastructure owner. A transport success
does not establish application recovery.

Use these entry points:

| Subject | Canonical document |
| --- | --- |
| Deployment and ordered production inputs | [Deployment](./DEPLOYMENT.md) |
| Backup format, acceptance, and production CLI stop condition | [Backup and restore](./BACKUP_AND_RESTORE.md) |
| PostgreSQL volume migration and rollback boundary | [PostgreSQL migration](../apps/server/docs/postgresql-production-migration.md) |
| Search recovery | [Search](./SEARCH.md) |
| Installation state and verification date | [State contract](./operations/STATE.md) |
| Historical evidence and acceptance mapping | [History contract](./operations/HISTORY.md) |

## Private operator store

For this checkout, `operator-data/` is the persistent local operator store.
It is deliberately excluded by the root `.gitignore`, separate from runtime
`data/`, generated `artifacts/`, and temporary `tmp/`. It holds private
installation facts and imported application excerpts. It must not be added to
Git, CI artifacts, generated graphs, releases, or public documentation.
The store's `README.md` is the operator entry point; `state.json` points to
content-addressed receipts in `history/sha256/`.

Creating this store does not establish off-host protection. Before deleting,
moving, or replacing a checkout, preserve the complete operator store to an
approved private location and verify its recorded hashes. A new clone does not
contain it. Do not use cleanup commands that include ignored operator data.
The deployment owner controls access, retention, and any additional copy.

Keep credentials and secret file contents in the deployment's existing secret
manager. Imported evidence may identify protected locations and configuration
hashes, but must not copy `.env` contents, passwords, tokens, or keys. Local
access restrictions do not authorize publishing any excerpt.

## Evidence and acceptance rules

Every installation observation needs its original timestamp, application
revision and registry digest where available, configuration identity, scope,
result, and explicit limitations. A registry digest differs from a local image
ID. An inventory field named `current_*` remains historical after import.
The import timestamp must never replace the original observation date.

The private receipt maps each source path and exact line span or JSON/YAML
pointer to its destination file and fragment. It records the source Git revision,
Git-blob SHA-256, projection SHA-256, and a reason for every retained mixed-source
remainder. A projection hash identifies the accepted projection, not the source
blob. Content-addressed history must not be overwritten in place; corrections
create a new receipt and update only the mutable state pointer.

Keep distinct evidence for archive hashes, actual database/storage recovery,
authenticated application acceptance, and coordinated external-storage recovery.
Historical cleanup approvals, skipped drills, and retention decisions apply
only to their dated operation. They do not authorize another cleanup or waive
current recovery gates.

Before an infrastructure owner removes application excerpts, the Docmost owner
must confirm the mapping, read the destination, verify its hashes and access,
and agree on durability/retention. Shared totals and anonymous Docker objects
without application ownership remain with infrastructure. A link to an old
source commit alone is not acceptance. Local adoption and local byte verification
do not by themselves approve source deletion.
