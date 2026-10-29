# Private application history

The canonical application history for this checkout resides in
`operator-data/history/sha256/`. Its operator index is
`operator-data/README.md`; its latest receipt is referenced from
`operator-data/state.json`. Access and preservation follow the
[private-store policy](../OPERATIONS.md#private-operator-store).

The 2026-10-29 import accepts Docmost fragments from the historical/current
infrastructure inventories and the mixed verification documents. It includes
original source hashes, observation dates, release identity, backup limitations,
cleanup decisions, and the application-owned object ledger. Each accepted
fragment is actually stored in a content-addressed private JSON file. The receipt
also records sources with no Docmost-specific payload and infrastructure-owned
remainders. The exact mapping is private because its destinations contain
installation paths and operational metadata.

Every source reference uses its original immutable Git revision. Each
destination filename is its own SHA-256, and the receipt records a separate
source-blob hash. Original `current_*` keys and historical timestamps are retained
as evidence; they do not describe the present installation. Contradictory
observations from different dates remain separate entries. Full cold recovery
cannot be inferred from transport checksums or an earlier release's acceptance.

These files are persistent operator records, not disposable QA output. Their
local hashes can detect alteration but do not provide write-once storage or an
off-host copy. The operator must confirm continued private access and retention
before the infrastructure owner deletes the corresponding source material.
No source deletion or infrastructure change is part of this import.
