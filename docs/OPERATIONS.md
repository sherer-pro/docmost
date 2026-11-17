# Operations

Use these entry points for supported application procedures:

| Subject | Document |
| --- | --- |
| Deployment and ordered production inputs | [Deployment](./DEPLOYMENT.md) |
| Backup format and production recovery | [Backup and restore](./BACKUP_AND_RESTORE.md) |
| PostgreSQL volume migration and rollback boundary | [PostgreSQL migration](../apps/server/docs/postgresql-production-migration.md) |
| Search recovery | [Search](./SEARCH.md) |
| Deployment-state procedures | [State navigation](./operations/STATE.md) |
| Archived source materials | [History navigation](./operations/HISTORY.md) |

Shared ingress, host/VPN/SSH policy, backup transport, retention locks, and PC
mirror generations remain with their infrastructure owner.
The [AllDocker backup contract](https://gitlab.sherer.pro/sherer-projects/alldocker-infra/-/blob/main/docs/BACKUPS.md)
describes that transport. The scheduled host archive and the supported
coordinated CLI archives have different formats; see
[the recovery boundary](./BACKUP_AND_RESTORE.md#host-generated-daily-archives).

Follow the deployment runbook for runtime configuration and deployment state.
Keep secrets out of Git, application images, CI artifacts, and public reports.
