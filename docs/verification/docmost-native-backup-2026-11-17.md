# Native scheduled backup acceptance - 17 November 2026

## Change and installed scope

The scheduled host producer now calls the coordinated native CLI through
`scripts/backup-scheduled.mjs`. It publishes the existing
`/backup/docmost.latest.tar` path as `docmost-backup/v1`, with exactly
`manifest.json`, `postgres.dump` and `storage.tar.gz`.

The immutable tool checkout is
`/opt/docmost/releases/backup-tools-9f8b67a72dce`, selected by
`/opt/docmost/backup-tool`. Its revision is
`9f8b67a72dceae1e79b14f2d8e40a797e0325eba`; Node is 22.23.2.
The two installed service drop-ins are `20-native.conf` from this repository
and a non-secret `90-host.conf` selecting the existing flattened release manifest
`/opt/docmost/compose.release.v1.3.1.yml`. This historical filename does not
identify the active application release.

The protected runtime input remains `/etc/docmost/docmost.env`, and deployment
state remains `/var/lib/docmost/deployment/postgres.env`. The application image
is unchanged: release 1.3.3,
`shererpro/docmost@sha256:a254a8d57867ed2cce0d32bb64c4e22a65ecad2b2ab88c90f6f278018fb5bf72`.
No application image, schema, source data volume, firewall or SSH credential was
replaced by this rollout.

## Protection and publication

Before switching the service, the previously installed native CLI created a
fresh coordinated backup, independently verified as v1. Its outer SHA-256 is
`1fb742c757ffe564c6113498d7631b0f12145e538f1e2b7b7e6a7cfc7c6e51eb`.
It was copied off-host and checked there. The old script/service/timer baseline
was also restored on the backup VPS with matching hashes, owner, mode and ACL.

The accepted scheduled control run was **20:53:25-20:55:33 MSK**, exit 0.
The timer remains **05:00 Europe/Moscow**. The measured 128-second chain leaves
27 minutes 52 seconds before the 05:30 pull; the first unattended daily cycle
still needs observation.

Published archive: **353,853,440 bytes**, SHA-256
`1130d9ea48878092861f8233017ce9a2b747ac0f8ad392e66f82d792207a1c6d`.
The publisher receipt reports the original creation time
`2026-11-17T17:54:12.225Z`. Both source writers returned healthy before
publication. The stale August outer `.sha256` file was preserved in the private
baseline and retired from transport; native payload checksums and the current
publisher receipt are authoritative.

Old eight-member host archives were not converted. Earlier points, including
earlier points on 17 November, retain that unsupported format. Verify the
member set before choosing native restore. No rdiff history was reinitialized
or manually shortened for this transition.

## Actual data recovery

The published archive above was restored by the native CLI on the application
VPS into a separate Compose project, fresh PostgreSQL/storage/Redis candidates,
and a separate Typesense volume. The target had no published ports and only
an internal network. The production state file and production volumes were
not selected as restore targets.

Native data-plane restore completed **21:10:06-21:11:45 MSK**. It recovered
37 users, 21 spaces, 772 pages, 483 attachments and the exact 123-migration
boundary. Independently comparing every restored storage file with the archive
confirmed **483 content hashes, 340,209,983 bytes**.

Application acceptance completed **21:38:59-21:39:50 MSK**:

- API, collaboration and the isolated Typesense service became healthy;
- authenticated reads of an existing page and an existing attachment passed;
- the downloaded attachment matched its restored file hash;
- a synthetic page and attachment were created, read back and removed;
- the full pages/attachments/dictionary reindex ran, the finite work queue
  drained, and the restored page and new canary were found in Typesense;
- application search returned the canary; 1,116 index documents were observed;
- after cleanup, database counts again matched the original archive.

The existing protected runtime inputs supplied the deployment's unchanged
environment-backed Docker secrets. The four core runtime values were compared
in memory with the running source and matched. Secret values were not recorded
in reports, Git or backup payloads. Preserve this secret provisioning profile
when restoring: local Docker requires writable service filesystems for
`secrets.environment`; read-only services require separately provisioned
file-backed secret sources.

The production state hash remained
`aef36a36f3c4384586915ce044249873b9637168ddb058c764eda5f0584eef6f`.
After acceptance, an exact inventory was used to remove seven stopped test
containers, six owned volumes and one internal network, without force or prune.
All five production data/application services remained healthy. Recovery
archives, baseline files and verification receipts were retained.

## Failures detected during acceptance

The first scheduled launcher invocation through the installed checkout symlink
silently skipped the ESM entry point. Archive postflight detected the unchanged
old archive despite service exit 0. The service override was rolled back;
`realpath` entry resolution and a failing-then-passing symlink regression fixed
the issue before the accepted control run.

The first application check incorrectly required an entirely empty delayed
search queue. The sole remaining job was the normal recurring reconciliation.
The corrected check excludes only explicit recurring jobs and still requires
finite rebuild work to finish, direct old/new index checks and actual API
search. The initial failed receipt was retained.

## Space and validation

Storage uses sorted GNU tar and standard `gzip -n --rsyncable`, preserving v1
restore compatibility. A separate synthetic storage-component test changed
76 bytes in a 16 MiB random file. The 16,798,502-byte compressed archive produced
a 25,420-byte rdiff increment; the previous test point restored with the exact
original hash. These figures are not a prediction of production daily growth.

Nineteen focused checks passed on Linux/Node 22, including actual process-group
termination and symlink invocation. The complete isolated native CLI
create/verify/restore suite passed with real PostgreSQL, Redis and Typesense;
its Windows preload paths were corrected without weakening assertions.
Release command contracts, English-comment checks and diff checks passed.

[CI for the runtime revision](https://github.com/sherer-pro/docmost/actions/runs/44141735740)
passed build/lint/unit and functional security steps, then failed at the
production dependency audit for unchanged `picomatch`
(`GHSA-fc5q-39xc-vjpf`). The lockfile is identical to the parent; this change
adds no runtime dependency. Downstream integration/image jobs were skipped,
and the overall CI is not green. No dependency exception or application release
was introduced to bypass that gate.

Private source receipts are under `/root/docmost-backup-20261117`; off-host
baseline/backup proof is under `/root/docmost-backup-20261117-offhost` on the
backup VPS. Transport, retention and PC mirror evidence remain with
[AllDocker](https://gitlab.sherer.pro/sherer-projects/alldocker-infra/-/blob/main/docs/BACKUPS.md).
Browser editing, two-client collaboration, public ingress cutover and complete
disaster-recovery RTO were not measured by this isolated acceptance.

## Rollback

For a later tool regression, select this accepted native tool revision and its
verified service configuration. Preserve a verified native archive independently
before changing the link. The pre-transition script is retained as evidence;
do not automatically re-enable it as a scheduled producer, because it writes
the unsupported host format. If the accepted native producer cannot run, stop
the timer while recovering it and retain the last verified native/off-host
copy. Never delete increments or shorten retention to force a successful run.
