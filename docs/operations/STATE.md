# Installation state contract

This public document describes where state belongs. It contains no private
installation snapshot. The operator opens `operator-data/README.md` and
`operator-data/state.json` in the owning checkout, following the
[operations policy](../OPERATIONS.md#private-operator-store).

The state record identifies the latest accepted history receipt, its SHA-256,
import date, original observation dates, and current-runtime verification
status. History and unresolved observations have separate fields. Updating
documentation or importing an old inventory must not set a live-health flag.
Private paths, image metadata from installed hosts, environment hashes, and
object ledgers remain in the private store.

The 2026-10-29 documentation task imports historical evidence without querying
the application hosts. Current runtime, backup freshness, authenticated UI
acceptance, and production recovery are not verified by this task. The exact
source-to-fragment map and local verification receipt belong to the private
store; they are not distributed by Git.

To record a future live observation, obtain its authorized read-only evidence,
create a new immutable history receipt, then update the state pointer. Keep the
original snapshot even when a later observation resolves an issue. The deployment
owner must set SLO targets, alert ownership, backup retention, and measured
RPO/RTO in the private installation record; this import does not establish them.
